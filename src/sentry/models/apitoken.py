from __future__ import absolute_import, print_function

import six

from bitfield import BitField
from datetime import timedelta
from django.conf import settings
from django.db import models
from django.utils import timezone
from uuid import uuid4

from sentry.db.models import (
    Model, BaseManager, FlexibleForeignKey, sane_repr
)

DEFAULT_EXPIRATION = timedelta(days=30)


class ApiToken(Model):
    __core__ = True

    # users can generate tokens without being application-bound
    application = FlexibleForeignKey('sentry.ApiApplication', null=True)
    user = FlexibleForeignKey('sentry.User')
    token = models.CharField(
        max_length=64, unique=True,
        default=lambda: ApiToken.generate_token())
    refresh_token = models.CharField(
        max_length=64, unique=True, null=True,
        default=lambda: ApiToken.generate_token())
    expires_at = models.DateTimeField(
        null=True,
        default=lambda: timezone.now() + DEFAULT_EXPIRATION)
    scopes = BitField(flags=tuple((k, k) for k in settings.SENTRY_SCOPES))
    date_added = models.DateTimeField(default=timezone.now)

    objects = BaseManager(cache_fields=(
        'token',
    ))

    class Meta:
        app_label = 'sentry'
        db_table = 'sentry_apitoken'

    __repr__ = sane_repr('key_id', 'user_id', 'token')

    def __unicode__(self):
        return six.text_type(self.token)

    @classmethod
    def generate_token(cls):
        return uuid4().hex + uuid4().hex

    @classmethod
    def from_grant(cls, grant):
        return cls.objects.create(
            application=grant.application,
            user=grant.user,
            scopes=grant.scopes,
        )

    def is_expired(self):
        if not self.expires_at:
            return True

        return timezone.now() >= self.expires_at

    def get_audit_log_data(self):
        return {
            'scopes': int(self.scopes),
        }

    def get_scopes(self):
        return [k for k, v in six.iteritems(self.scopes) if v]

    def has_scope(self, scope):
        return scope in self.scopes

    def get_allowed_origins(self):
        if self.application:
            return self.key.get_allowed_origins()
        return ()

    def refresh(self, expires_at=None):
        if expires_at is None:
            expires_at = timezone.now() + DEFAULT_EXPIRATION

        self.update(
            token=type(self).generate_token(),
            refresh_token=type(self).generate_token(),
            expires_at=expires_at,
        )
