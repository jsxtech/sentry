import type {Location} from 'history';

import {Link} from 'sentry/components/core/link';
import {trackAnalytics} from 'sentry/utils/analytics';
import {generateLinkToEventInTraceView} from 'sentry/utils/discover/urls';
import normalizeUrl from 'sentry/utils/url/normalizeUrl';
import useOrganization from 'sentry/utils/useOrganization';
import {SPAN_ID_DISPLAY_LENGTH} from 'sentry/views/insights/http/settings';
import {useDomainViewFilters} from 'sentry/views/insights/pages/useFilters';
import type {ModuleName} from 'sentry/views/insights/types';
import type {TraceViewSources} from 'sentry/views/performance/newTraceDetails/traceHeader/breadcrumbs';

interface Props {
  location: Location;
  moduleName: ModuleName;
  spanId: string;
  timestamp: string;
  traceId: string;
  source?: TraceViewSources;
  transactionId?: string;
  transactionSpanId?: string;
}

export function SpanIdCell({
  moduleName,
  traceId,
  transactionId,
  transactionSpanId,
  spanId,
  timestamp,
  source,
  location,
}: Props) {
  const organization = useOrganization();
  const domainViewFilters = useDomainViewFilters();
  const url = normalizeUrl(
    generateLinkToEventInTraceView({
      eventId: transactionId,
      targetId: transactionSpanId,
      traceSlug: traceId,
      timestamp,
      organization,
      location,
      spanId,
      source,
      view: domainViewFilters.view,
    })
  );

  return (
    <Link
      onClick={() =>
        trackAnalytics('performance_views.sample_spans.span_clicked', {
          organization,
          source: moduleName,
        })
      }
      to={url}
    >
      {spanId.slice(0, SPAN_ID_DISPLAY_LENGTH)}
    </Link>
  );
}
