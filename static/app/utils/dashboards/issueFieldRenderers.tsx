import {Fragment} from 'react';
import {css} from '@emotion/react';
import styled from '@emotion/styled';
import type {Location} from 'history';

import {Link} from 'sentry/components/core/link';
import {Tooltip} from 'sentry/components/core/tooltip';
import Count from 'sentry/components/count';
import ExternalLink from 'sentry/components/links/externalLink';
import {getRelativeSummary} from 'sentry/components/timeRangeSelector/utils';
import {DEFAULT_STATS_PERIOD} from 'sentry/constants';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {Organization} from 'sentry/types/organization';
import {IssueAssignee} from 'sentry/utils/dashboards/issueAssignee';
import type {EventData, MetaType} from 'sentry/utils/discover/eventView';
import EventView from 'sentry/utils/discover/eventView';
import type {FieldFormatterRenderFunctionPartial} from 'sentry/utils/discover/fieldRenderers';
import {getFieldRenderer} from 'sentry/utils/discover/fieldRenderers';
import {Container, FieldShortId, OverflowLink} from 'sentry/utils/discover/styles';
import {SavedQueryDatasets} from 'sentry/utils/discover/types';
import {hasDatasetSelector} from 'sentry/views/dashboards/utils';
import {FieldKey} from 'sentry/views/dashboards/widgetBuilder/issueWidget/fields';
import {QuickContextHoverWrapper} from 'sentry/views/discover/table/quickContext/quickContextWrapper';
import {ContextType} from 'sentry/views/discover/table/quickContext/utils';

/**
 * Types, functions and definitions for rendering fields in discover results.
 */
type RenderFunctionBaggage = {
  location: Location;
  organization: Organization;
  eventView?: EventView;
};

type SpecialFieldRenderFunc = (
  data: EventData,
  baggage: RenderFunctionBaggage
) => React.ReactNode;

type SpecialField = {
  renderFunc: SpecialFieldRenderFunc;
  sortField: string | null;
};

type SpecialFields = {
  assignee: SpecialField;
  count: SpecialField;
  events: SpecialField;
  issue: SpecialField;
  lifetimeCount: SpecialField;
  lifetimeEvents: SpecialField;
  lifetimeUserCount: SpecialField;
  lifetimeUsers: SpecialField;
  links: SpecialField;
  userCount: SpecialField;
  users: SpecialField;
};

/**
 * "Special fields" either do not map 1:1 to an single column in the event database,
 * or they require custom UI formatting that can't be handled by the datatype formatters.
 */
const SPECIAL_FIELDS: SpecialFields = {
  issue: {
    sortField: null,
    renderFunc: (data, {organization}) => {
      const issueID = data['issue.id'];

      if (!issueID) {
        return (
          <Container>
            <FieldShortId shortId={`${data.issue}`} />
          </Container>
        );
      }

      const target = {
        pathname: `/organizations/${organization.slug}/issues/${issueID}/`,
      };

      return (
        <Container>
          <QuickContextHoverWrapper
            dataRow={data}
            contextType={ContextType.ISSUE}
            organization={organization}
          >
            <OverflowLink to={target} aria-label={issueID}>
              <FieldShortId shortId={`${data.issue}`} />
            </OverflowLink>
          </QuickContextHoverWrapper>
        </Container>
      );
    },
  },
  assignee: {
    sortField: null,
    renderFunc: data => <IssueAssignee groupId={data.id} />,
  },
  lifetimeEvents: {
    sortField: null,
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'lifetimeEvents'),
  },
  lifetimeUsers: {
    sortField: null,
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'lifetimeUsers'),
  },
  events: {
    sortField: 'freq',
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'events'),
  },
  users: {
    sortField: 'user',
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'users'),
  },
  lifetimeCount: {
    sortField: null,
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'lifetimeEvents'),
  },
  lifetimeUserCount: {
    sortField: null,
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'lifetimeUsers'),
  },
  count: {
    sortField: null,
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'events'),
  },
  userCount: {
    sortField: null,
    renderFunc: (data, {organization}) =>
      issuesCountRenderer(data, organization, 'users'),
  },
  links: {
    sortField: null,
    renderFunc: ({links}) => (
      <LinksContainer>
        {links.map((link: any, index: any) => (
          <ExternalLink key={index} href={link.url}>
            {link.displayName}
          </ExternalLink>
        ))}
      </LinksContainer>
    ),
  },
};

const issuesCountRenderer = (
  data: EventData,
  organization: Organization,
  field: 'events' | 'users' | 'lifetimeEvents' | 'lifetimeUsers'
) => {
  const {start, end, period} = data;
  const isUserField = !!/user/i.exec(field.toLowerCase());
  const primaryCount = data[field];
  const count = data[isUserField ? 'users' : 'events'];
  const lifetimeCount = data[isUserField ? 'lifetimeUsers' : 'lifetimeEvents'];
  const filteredCount = data[isUserField ? 'filteredUsers' : 'filteredEvents'];
  const discoverLink = getDiscoverUrl(data, organization);
  const filteredDiscoverLink = getDiscoverUrl(data, organization, true);
  const selectionDateString =
    !!start && !!end
      ? 'time range'
      : getRelativeSummary(period || DEFAULT_STATS_PERIOD).toLowerCase();
  return (
    <Container>
      <Tooltip
        isHoverable
        skipWrapper
        overlayStyle={{padding: 0}}
        title={
          <div>
            {filteredCount ? (
              <Fragment>
                <StyledLink to={filteredDiscoverLink}>
                  {t('Matching search filters')}
                  <WrappedCount value={filteredCount} />
                </StyledLink>
                <Divider />
              </Fragment>
            ) : null}
            <StyledLink to={discoverLink}>
              {t('Total in %s', selectionDateString)}
              <WrappedCount value={count} />
            </StyledLink>
            <Divider />
            <StyledContent>
              {t('Since issue began')}
              <WrappedCount value={lifetimeCount} />
            </StyledContent>
          </div>
        }
      >
        <span>
          {['events', 'users'].includes(field) && filteredCount ? (
            <Fragment>
              <Count value={filteredCount} />
              <SecondaryCount value={primaryCount} />
            </Fragment>
          ) : (
            <Count value={primaryCount} />
          )}
        </span>
      </Tooltip>
    </Container>
  );
};

const getDiscoverUrl = (
  data: EventData,
  organization: Organization,
  filtered?: boolean
) => {
  const commonQuery = {projects: [Number(data.projectId)]};
  const discoverView = EventView.fromSavedQuery({
    ...commonQuery,
    id: undefined,
    start: data.start,
    end: data.end,
    range: data.period,
    name: data.title,
    fields: ['title', 'release', 'environment', 'user', 'timestamp'],
    orderby: '-timestamp',
    query: `issue.id:${data.id}${filtered ? data.discoverSearchQuery : ''}`,
    version: 2,
  });
  return discoverView.getResultsViewUrlTarget(
    organization,
    false,
    hasDatasetSelector(organization) ? SavedQueryDatasets.ERRORS : undefined
  );
};

export function getSortField(field: string): string | null {
  if (SPECIAL_FIELDS.hasOwnProperty(field)) {
    return SPECIAL_FIELDS[field as keyof typeof SPECIAL_FIELDS].sortField;
  }
  switch (field) {
    case FieldKey.LAST_SEEN:
      return 'date';
    case FieldKey.FIRST_SEEN:
      return 'new';
    default:
      return null;
  }
}

const contentStyle = css`
  width: 100%;
  justify-content: space-between;
  display: flex;
  padding: 6px 10px;
`;

const StyledContent = styled('div')`
  ${contentStyle};
`;

const StyledLink = styled(Link)`
  ${contentStyle};
  color: ${p => p.theme.gray400};
  &:hover {
    color: ${p => p.theme.gray400};
    background: ${p => p.theme.hover};
  }
`;

const SecondaryCount = styled(Count)`
  :before {
    content: '/';
    padding-left: ${space(0.25)};
    padding-right: 2px;
  }
`;

const WrappedCount = styled(({value, ...p}: any) => (
  <div {...p}>
    <Count value={value} />
  </div>
))`
  text-align: right;
  font-weight: ${p => p.theme.fontWeight.bold};
  font-variant-numeric: tabular-nums;
  padding-left: ${space(2)};
  color: ${p => p.theme.subText};
`;

const Divider = styled('div')`
  height: 1px;
  overflow: hidden;
  background-color: ${p => p.theme.innerBorder};
`;

const LinksContainer = styled('span')`
  white-space: nowrap;
`;

/**
 * Get the field renderer for the named field and metadata
 *
 * @param {String} field name
 * @param {object} metadata mapping.
 * @returns {Function}
 */
export function getIssueFieldRenderer(
  field: string,
  meta: MetaType
): FieldFormatterRenderFunctionPartial {
  if (SPECIAL_FIELDS.hasOwnProperty(field)) {
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    return SPECIAL_FIELDS[field].renderFunc;
  }

  return getFieldRenderer(field, meta, false);
}
