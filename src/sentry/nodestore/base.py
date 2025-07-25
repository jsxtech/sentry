from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime, timedelta
from threading import local
from typing import Any

import sentry_sdk
from django.core.cache import BaseCache, InvalidCacheBackendError, caches
from django.utils.functional import cached_property

from sentry import options
from sentry.utils import json, metrics
from sentry.utils.services import Service
from sentry.utils.storage import measure_storage_put

# Cache an instance of the encoder we want to use
json_dumps = json.JSONEncoder(
    separators=(",", ":"),
    sort_keys=True,
    skipkeys=False,
    ensure_ascii=True,
    check_circular=True,
    allow_nan=True,
    indent=None,
    encoding="utf-8",
    default=None,
).encode

json_loads = json.loads


class NodeStorage(local, Service):
    """
    Nodestore is a key-value store that is used to store event payloads. It comes in two flavors:

    * Django backend, which is just KV-store implemented on top of postgres.
    * Bigtable backend

    Keys (ids) in nodestore are strings, and values (nodes) are
    JSON-serializable objects. Nodestore additionally has the concept of
    subkeys, which are additional JSON payloads that should be stored together
    with the same "main" value. Internally those values are concatenated and
    compressed as one bytestream which makes them compress very well. This:

    >>> nodestore.set("key1", "my key")
    >>> nodestore.set("key1.1", "my key 2")
    >>> nodestore.get("key1")
    "my key"
    >>> nodestore.get("key1.1")
    "my key 2"

    ...very likely takes more space than:

    >>> nodestore.set_subkeys("key1", {None: "my key", "1": "my key 2"})
    >>> nodestore.get("key1")
    "my key"
    >>> nodestore.get("key1", subkey="1")
    "my key 2"

    ...simply because compressing "my key<SEPARATOR>my key 2" yields better
    compression ratio than compressing each key individually.

    This is used in reprocessing to store a snapshot of the event from multiple
    stages of the pipeline.
    """

    __all__ = (
        "delete",
        "delete_multi",
        "get",
        "get_bytes",
        "get_multi",
        "set",
        "set_bytes",
        "set_subkeys",
        "cleanup",
        "validate",
        "bootstrap",
    )

    def delete(self, id: str) -> None:
        """
        >>> nodestore.delete('key1')
        """
        raise NotImplementedError

    def delete_multi(self, id_list: list[str]) -> None:
        """
        Delete multiple nodes.

        Note: This is not guaranteed to be atomic and may result in a partial
        delete.

        >>> delete_multi(['key1', 'key2'])
        """
        for id in id_list:
            self.delete(id)

    def _decode(self, value: None | bytes, subkey: str | None) -> Any | None:
        if value is None:
            return None

        lines_iter = iter(value.splitlines())
        try:
            if subkey is not None:
                # Those keys should be statically known identifiers in the app, such as
                # "unprocessed_event". There is really no reason to allow anything but
                # ASCII here.
                _subkey = subkey.encode("ascii")

                next(lines_iter)

                for line in lines_iter:
                    if line.strip() == _subkey:
                        break

                    next(lines_iter)

            return json_loads(next(lines_iter))
        except StopIteration:
            return None

    def get_bytes(self, id: str) -> bytes | None:
        """
        >>> nodestore._get_bytes('key1')
        b'{"message": "hello world"}'
        """
        return self._get_bytes(id)

    def _get_bytes(self, id: str) -> bytes | None:
        raise NotImplementedError

    @metrics.wraps("nodestore.get.duration")
    def get(self, id: str, subkey: str | None = None) -> Any:
        """
        >>> nodestore.get('key1')
        {"message": "hello world"}
        """
        with sentry_sdk.start_span(op="nodestore.get") as span:
            span.set_tag("node_id", id)
            if subkey is None:
                item_from_cache = self._get_cache_item(id)
                if item_from_cache:
                    metrics.incr("nodestore.get", tags={"cache": "hit"})
                    span.set_tag("origin", "from_cache")
                    span.set_tag("found", bool(item_from_cache))
                    return item_from_cache

            span.set_tag("subkey", str(subkey))
            bytes_data = self._get_bytes(id)
            rv = self._decode(bytes_data, subkey=subkey)
            if subkey is None:
                # set cache item only after we know decoding did not fail
                self._set_cache_item(id, rv)

            span.set_tag("result", "from_service")
            if bytes_data:
                span.set_tag("bytes.size", len(bytes_data))
            span.set_tag("found", bool(rv))
            metrics.incr("nodestore.get", tags={"cache": "miss", "found": bool(rv)})

            return rv

    def _get_bytes_multi(self, id_list: list[str]) -> dict[str, bytes | None]:
        """
        >>> nodestore._get_bytes_multi(['key1', 'key2')
        {
            "key1": b'{"message": "hello world"}',
            "key2": b'{"message": "hello world"}'
        }
        """
        return {id: self._get_bytes(id) for id in id_list}

    def get_multi(self, id_list: list[str], subkey: str | None = None) -> dict[str, Any | None]:
        """
        >>> nodestore.get_multi(['key1', 'key2')
        {
            "key1": {"message": "hello world"},
            "key2": {"message": "hello world"}
        }
        """
        with sentry_sdk.start_span(op="nodestore.get_multi") as span:
            # Deduplicate ids, preserving order
            id_list = list(dict.fromkeys(id_list))
            span.set_tag("subkey", str(subkey))
            span.set_tag("num_ids", len(id_list))

            if subkey is None:
                cache_items = self._get_cache_items(id_list)
                if len(cache_items) == len(id_list):
                    span.set_tag("result", "from_cache")
                    return cache_items

                uncached_ids = [id for id in id_list if id not in cache_items]
            else:
                uncached_ids = id_list

            with sentry_sdk.start_span(op="nodestore._get_bytes_multi_and_decode") as span:
                items = {
                    id: self._decode(value, subkey=subkey)
                    for id, value in self._get_bytes_multi(uncached_ids).items()
                }
            if subkey is None:
                self._set_cache_items(items)
                items.update(cache_items)

            span.set_tag("result", "from_service")
            span.set_tag("found", len(items))

            return items

    def _encode(self, data: dict[str | None, Mapping[str, Any]]) -> bytes:
        """
        Encode data dict in a way where its keys can be deserialized
        independently. A `None` key must always be present which is served as
        the "default" subkey (the regular event payload).

        >>> _encode({"unprocessed": {}, None: {"stacktrace": {}}})
        b'{"stacktrace": {}}\nunprocessed\n{}'
        """
        lines = [json_dumps(data.pop(None)).encode("utf8")]
        for key, value in data.items():
            if key is not None:
                lines.append(key.encode("ascii"))
                lines.append(json_dumps(value).encode("utf8"))

        return b"\n".join(lines)

    def set_bytes(self, item_id: str, data: bytes, ttl: timedelta | None = None) -> None:
        """
        >>> nodestore.set_bytes('key1', b"{'foo': 'bar'}")
        """
        metrics.distribution("nodestore.set_bytes", len(data))
        with measure_storage_put(len(data), "nodestore"):
            return self._set_bytes(item_id, data, ttl)

    def _set_bytes(self, item_id: str, data: bytes, ttl: timedelta | None = None) -> None:
        raise NotImplementedError

    def set(self, item_id: str, data: Mapping[str, Any], ttl: timedelta | None = None) -> None:
        """
        Set value for `item_id`. Note that this deletes existing subkeys for `item_id` as
        well, use `set_subkeys` to write a value + subkeys.

        >>> nodestore.set('key1', {'foo': 'bar'})
        """
        return self.set_subkeys(item_id, {None: data}, ttl=ttl)

    @sentry_sdk.tracing.trace
    def set_subkeys(
        self, item_id: str, data: dict[str | None, Mapping[str, Any]], ttl: timedelta | None = None
    ) -> None:
        """
        Set value for `item_id` and its subkeys.

        >>> nodestore.set_subkeys('key1', {
        ...    None: {'foo': 'bar'},
        ...    "reprocessing": {'foo': 'bam'},
        ... })

        >>> nodestore.get('key1')
        {'foo': 'bar'}
        >>> nodestore.get('key1', subkey='reprocessing')
        {'foo': 'bam'}
        """
        cache_item = data.get(None)
        bytes_data = self._encode(data)
        self.set_bytes(item_id, bytes_data, ttl=ttl)
        # set cache only after encoding and write to nodestore has succeeded
        if options.get("nodestore.set-subkeys.enable-set-cache-item"):
            self._set_cache_item(item_id, cache_item)

    def cleanup(self, cutoff_timestamp: datetime) -> None:
        raise NotImplementedError

    def bootstrap(self) -> None:
        raise NotImplementedError

    def _get_cache_item(self, item_id: str) -> Any | None:
        if self.cache:
            return self.cache.get(item_id)
        return None

    @sentry_sdk.tracing.trace
    def _get_cache_items(self, id_list: list[str]) -> dict[str, Any]:
        if self.cache:
            return self.cache.get_many(id_list)
        return {}

    def _set_cache_item(self, item_id: str, data: Any) -> None:
        if self.cache and data:
            self.cache.set(item_id, data)

    @sentry_sdk.tracing.trace
    def _set_cache_items(self, items: dict[Any, Any]) -> None:
        if self.cache:
            self.cache.set_many(items)

    def _delete_cache_item(self, item_id: str) -> None:
        if self.cache:
            self.cache.delete(item_id)

    def _delete_cache_items(self, id_list: list[str]) -> None:
        if self.cache:
            self.cache.delete_many([item_id for item_id in id_list])

    @cached_property
    def cache(self) -> BaseCache | None:
        try:
            return caches["nodedata"]
        except InvalidCacheBackendError:
            return None
