import {Fragment} from 'react';
import styled from '@emotion/styled';
import type {LocationDescriptor} from 'history';

import {LinkButton} from 'sentry/components/core/button/linkButton';
import {Link} from 'sentry/components/core/link';
import GroupList from 'sentry/components/issues/groupList';
import LoadingError from 'sentry/components/loadingError';
import LoadingIndicator from 'sentry/components/loadingIndicator';
import {t, tct} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {Group} from 'sentry/types/group';
import type {Organization} from 'sentry/types/organization';
import {useApiQuery} from 'sentry/utils/queryClient';
import useOrganization from 'sentry/utils/useOrganization';

type RelatedIssuesResponse = {
  data: number[];
  meta: {
    event_id: string;
    trace_id: string;
  };
  type: string;
};

function GroupRelatedIssues({group}: {group: Group}) {
  return (
    <Fragment>
      <RelatedIssuesSection group={group} relationType="same_root_cause" />
      <RelatedIssuesSection group={group} relationType="trace_connected" />
    </Fragment>
  );
}

interface RelatedIssuesSectionProps {
  group: Group;
  relationType: string;
}

function RelatedIssuesSection({group, relationType}: RelatedIssuesSectionProps) {
  const organization = useOrganization();
  // Fetch the list of related issues
  const hasGlobalViewsFeature = organization.features.includes('global-views');
  const {
    isPending,
    isError,
    data: relatedIssues,
    refetch,
  } = useApiQuery<RelatedIssuesResponse>(
    [
      `/issues/${group.id}/related-issues/`,
      {
        query: {
          ...(hasGlobalViewsFeature ? undefined : {project: group.project.id}),
          type: relationType,
        },
      },
    ],
    {
      staleTime: 0,
    }
  );

  const traceMeta = relationType === 'trace_connected' ? relatedIssues?.meta : undefined;
  const issues = relatedIssues?.data ?? [];
  const query = `issue.id:[${issues}]`;
  let title: React.ReactNode = null;
  let extraInfo: React.ReactNode = null;
  let openIssuesButton: React.ReactNode = null;
  if (relationType === 'trace_connected' && traceMeta) {
    ({title, extraInfo, openIssuesButton} = getTraceConnectedContent(
      traceMeta,
      organization,
      group
    ));
  } else {
    title = t('Issues with similar titles');
    extraInfo = t(
      'These issues have the same title and may have been caused by the same root cause.'
    );
    openIssuesButton = getLinkButton(
      {
        pathname: `/organizations/${organization.slug}/issues/`,
        query: {
          // project=-1 allows ensuring that the query will show issues from any projects for the org
          // This is important for traces since issues can be for any project in the org
          ...(hasGlobalViewsFeature ? {project: '-1'} : {project: group.project.id}),
          query: `issue.id:[${group.id},${issues}]`,
        },
      },
      'Clicked Open Issues from same-root related issues',
      'similar_issues.same_root_cause_clicked_open_issues'
    );
  }

  return (
    <Fragment>
      {isPending ? (
        <LoadingIndicator />
      ) : isError ? (
        <LoadingError
          message={t('Unable to load related issues, please try again later')}
          onRetry={refetch}
        />
      ) : issues.length > 0 ? (
        <Fragment>
          <HeaderWrapper>
            <Title>{title}</Title>
            <TextButtonWrapper>
              <span>{extraInfo}</span>
              {openIssuesButton}
            </TextButtonWrapper>
          </HeaderWrapper>
          <GroupList
            queryParams={{
              query,
              ...(hasGlobalViewsFeature ? undefined : {project: group.project.id}),
            }}
            source="similar-issues-tab"
            canSelectGroups={false}
            withChart={false}
            withColumns={['event']}
          />
        </Fragment>
      ) : null}
    </Fragment>
  );
}

const getTraceConnectedContent = (
  traceMeta: RelatedIssuesResponse['meta'],
  organization: Organization,
  group: Group
) => {
  const hasGlobalViewsFeature = organization.features.includes('global-views');
  const title = t('Issues in the same trace');
  const url = `/organizations/${organization.slug}/performance/trace/${traceMeta.trace_id}/?node=error-${traceMeta.event_id}`;
  const extraInfo = (
    <small>
      {tct('These issues were all found within [traceLink:this trace]', {
        traceLink: <Link to={url}>{t('this trace')}</Link>,
      })}
    </small>
  );
  const openIssuesButton = getLinkButton(
    {
      pathname: `/organizations/${organization.slug}/issues/`,
      query: {
        // project=-1 allows ensuring that the query will show issues from any projects for the org
        // This is important for traces since issues can be for any project in the org
        ...(hasGlobalViewsFeature ? {project: '-1'} : {project: group.project.id}),
        query: `trace:${traceMeta.trace_id}`,
      },
    },
    'Clicked Open Issues from trace-connected related issues',
    'similar_issues.trace_connected_issues_clicked_open_issues'
  );

  return {title, extraInfo, openIssuesButton};
};

const getLinkButton = (to: LocationDescriptor, eventName: string, eventKey: string) => {
  return (
    <LinkButton
      to={to}
      size="xs"
      analyticsEventName={eventName}
      analyticsEventKey={eventKey}
    >
      {t('Open in Issues')}
    </LinkButton>
  );
};

// Export the component without feature flag controls
export {GroupRelatedIssues};

const Title = styled('h4')`
  font-size: ${p => p.theme.fontSize.lg};
  margin-bottom: ${space(0.75)};
`;

const HeaderWrapper = styled('div')`
  margin-bottom: ${space(2)};

  small {
    color: ${p => p.theme.subText};
  }
`;

const TextButtonWrapper = styled('div')`
  align-items: center;
  display: flex;
  justify-content: space-between;
  margin-bottom: ${space(1)};
  width: 100%;
`;
