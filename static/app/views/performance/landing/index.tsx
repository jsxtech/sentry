import type {FC} from 'react';
import {Fragment, useEffect, useMemo, useRef} from 'react';
import styled from '@emotion/styled';
import type {Location} from 'history';

import {Link} from 'sentry/components/core/link';
import {TabList, TabPanels, Tabs} from 'sentry/components/core/tabs';
import FeedbackWidgetButton from 'sentry/components/feedback/widget/feedbackWidgetButton';
import * as Layout from 'sentry/components/layouts/thirds';
import LoadingIndicator from 'sentry/components/loadingIndicator';
import {DatePageFilter} from 'sentry/components/organizations/datePageFilter';
import {EnvironmentPageFilter} from 'sentry/components/organizations/environmentPageFilter';
import PageFilterBar from 'sentry/components/organizations/pageFilterBar';
import {ProjectPageFilter} from 'sentry/components/organizations/projectPageFilter';
import {PageHeadingQuestionTooltip} from 'sentry/components/pageHeadingQuestionTooltip';
import TransactionNameSearchBar from 'sentry/components/performance/searchBar';
import * as TeamKeyTransactionManager from 'sentry/components/performance/teamKeyTransactionsManager';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {PageFilters} from 'sentry/types/core';
import type {InjectedRouter} from 'sentry/types/legacyReactRouter';
import type {Organization} from 'sentry/types/organization';
import type {Project} from 'sentry/types/project';
import {trackAnalytics} from 'sentry/utils/analytics';
import {browserHistory} from 'sentry/utils/browserHistory';
import type EventView from 'sentry/utils/discover/eventView';
import {GenericQueryBatcher} from 'sentry/utils/performance/contexts/genericQueryBatcher';
import {MetricsCardinalityProvider} from 'sentry/utils/performance/contexts/metricsCardinality';
import type {MEPState} from 'sentry/utils/performance/contexts/metricsEnhancedSetting';
import {
  MEPConsumer,
  MEPSettingProvider,
} from 'sentry/utils/performance/contexts/metricsEnhancedSetting';
import {PageAlert, usePageAlert} from 'sentry/utils/performance/contexts/pageAlert';
import {MutableSearch} from 'sentry/utils/tokenizeSearch';
import {useTeams} from 'sentry/utils/useTeams';
import {BACKEND_SIDEBAR_LABEL} from 'sentry/views/insights/pages/backend/settings';
import {FRONTEND_SIDEBAR_LABEL} from 'sentry/views/insights/pages/frontend/settings';
import {MOBILE_SIDEBAR_LABEL} from 'sentry/views/insights/pages/mobile/settings';
import {LegacyOnboarding} from 'sentry/views/performance/onboarding';
import {MetricsEventsDropdown} from 'sentry/views/performance/transactionSummary/transactionOverview/metricEvents/metricsEventsDropdown';
import {
  getPerformanceBaseUrl,
  getTransactionSearchQuery,
} from 'sentry/views/performance/utils';

import {AllTransactionsView} from './views/allTransactionsView';
import {BackendView} from './views/backendView';
import {FrontendOtherView} from './views/frontendOtherView';
import {FrontendPageloadView} from './views/frontendPageloadView';
import {MobileView} from './views/mobileView';
import {MetricsDataSwitcher} from './metricsDataSwitcher';
import {MetricsDataSwitcherAlert} from './metricsDataSwitcherAlert';
import {
  getDefaultDisplayForPlatform,
  getLandingDisplayFromParam,
  handleLandingDisplayChange,
  LANDING_DISPLAYS,
  LandingDisplayField,
} from './utils';

type Props = {
  eventView: EventView;
  handleSearch: (searchQuery: string, currentMEPState?: MEPState) => void;
  location: Location;
  onboardingProject: Project | undefined;
  organization: Organization;
  projects: Project[];
  router: InjectedRouter;
  selection: PageFilters;
  setError: (msg: string | undefined) => void;
  withStaticFilters: boolean;
};

const fieldToViewMap: Record<LandingDisplayField, FC<Props>> = {
  [LandingDisplayField.ALL]: AllTransactionsView,
  [LandingDisplayField.BACKEND]: BackendView,
  [LandingDisplayField.FRONTEND_OTHER]: FrontendOtherView,
  [LandingDisplayField.FRONTEND_PAGELOAD]: FrontendPageloadView,
  [LandingDisplayField.MOBILE]: MobileView,
};

export function PerformanceLanding(props: Props) {
  const {organization, location, eventView, projects, handleSearch, onboardingProject} =
    props;
  const {setPageError, pageAlert} = usePageAlert();
  const {teams, initiallyLoaded} = useTeams({provideUserTeams: true});
  const {slug} = organization;

  const performanceMovingAlert = useMemo(() => {
    if (!slug) {
      return undefined;
    }
    return (
      <Fragment>
        {t(
          `To make it easier to see what's relevant for you, Sentry's Performance landing page is now being split into separate `
        )}
        <Link to={`${getPerformanceBaseUrl(slug, 'frontend')}/`}>
          {FRONTEND_SIDEBAR_LABEL}
        </Link>
        {`, `}
        <Link to={`${getPerformanceBaseUrl(slug, 'backend')}/`}>
          {BACKEND_SIDEBAR_LABEL}
        </Link>
        {t(', and ')}
        <Link to={`${getPerformanceBaseUrl(slug, 'mobile')}/`}>
          {MOBILE_SIDEBAR_LABEL}
        </Link>
        {t(' performance pages. They can all be found in the Insights tab.')}
      </Fragment>
    );
  }, [slug]);

  const hasMounted = useRef(false);
  const paramLandingDisplay = getLandingDisplayFromParam(location);
  const defaultLandingDisplayForProjects = getDefaultDisplayForPlatform(
    projects,
    eventView
  );
  const landingDisplay = paramLandingDisplay ?? defaultLandingDisplayForProjects;
  const showOnboarding = onboardingProject !== undefined;

  useEffect(() => {
    if (performanceMovingAlert && pageAlert?.message !== performanceMovingAlert) {
      setPageError(performanceMovingAlert);
    }
  }, [pageAlert?.message, performanceMovingAlert, setPageError]);

  useEffect(() => {
    if (hasMounted.current) {
      browserHistory.replace({
        pathname: location.pathname,
        query: {
          ...location.query,
          landingDisplay: undefined,
        },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventView.project.join('.')]);

  useEffect(() => {
    hasMounted.current = true;
  }, []);

  useEffect(() => {
    if (showOnboarding) {
      trackAnalytics('performance_views.overview.has_data', {
        table_data_state: 'onboarding',
        tab: paramLandingDisplay?.field,
        organization,
      });
    }
  }, [showOnboarding, paramLandingDisplay, organization]);

  const getFreeTextFromQuery = (query: string) => {
    const conditions = new MutableSearch(query);
    const transactionValues = conditions.getFilterValues('transaction');
    if (transactionValues.length) {
      return transactionValues[0];
    }
    if (conditions.freeText.length > 0) {
      // raw text query will be wrapped in wildcards in generatePerformanceEventView
      // so no need to wrap it here
      return conditions.freeText.join(' ');
    }
    return '';
  };

  const derivedQuery = getTransactionSearchQuery(location, eventView.query);

  const ViewComponent = fieldToViewMap[landingDisplay.field];

  let pageFilters: React.ReactNode = (
    <PageFilterBar condensed>
      <ProjectPageFilter />
      <EnvironmentPageFilter />
      <DatePageFilter />
    </PageFilterBar>
  );

  if (showOnboarding) {
    pageFilters = <SearchContainerWithFilter>{pageFilters}</SearchContainerWithFilter>;
  }

  const SearchFilterContainer = organization.features.includes('performance-use-metrics')
    ? SearchContainerWithFilterAndMetrics
    : SearchContainerWithFilter;

  return (
    <Layout.Page data-test-id="performance-landing-v3">
      <Tabs
        value={landingDisplay.field}
        onChange={field =>
          handleLandingDisplayChange(field, location, projects, organization, eventView)
        }
      >
        <Layout.Header>
          <Layout.HeaderContent>
            <Layout.Title>
              {t('Performance')}
              <PageHeadingQuestionTooltip
                docsUrl="https://docs.sentry.io/product/performance/"
                title={t(
                  'Your main view for transaction data with graphs that visualize transactions or trends, as well as a table where you can drill down on individual transactions.'
                )}
              />
            </Layout.Title>
          </Layout.HeaderContent>
          <Layout.HeaderActions>
            {!showOnboarding && <FeedbackWidgetButton />}
          </Layout.HeaderActions>

          <TabList hideBorder>
            {LANDING_DISPLAYS.map(({label, field}) => (
              <TabList.Item key={field}>{label}</TabList.Item>
            ))}
          </TabList>
        </Layout.Header>

        <Layout.Body data-test-id="performance-landing-body">
          <Layout.Main fullWidth>
            <TabPanels>
              <TabPanels.Item key={landingDisplay.field}>
                <MetricsCardinalityProvider
                  sendOutcomeAnalytics
                  organization={organization}
                  location={location}
                >
                  <MetricsDataSwitcher
                    organization={organization}
                    eventView={eventView}
                    location={location}
                  >
                    {metricsDataSide => {
                      return (
                        <MEPSettingProvider
                          location={location}
                          forceTransactions={metricsDataSide.forceTransactionsOnly}
                        >
                          <MetricsDataSwitcherAlert
                            organization={organization}
                            eventView={eventView}
                            projects={projects}
                            location={location}
                            router={props.router}
                            {...metricsDataSide}
                          />
                          <PageAlert />
                          {showOnboarding ? (
                            <Fragment>
                              {pageFilters}
                              <LegacyOnboarding
                                organization={organization}
                                project={onboardingProject}
                              />
                            </Fragment>
                          ) : (
                            <Fragment>
                              <SearchFilterContainer>
                                {pageFilters}
                                <MEPConsumer>
                                  {({metricSettingState}) => (
                                    // TODO replace `handleSearch prop` with transaction name search once
                                    // transaction name search becomes the default search bar
                                    <TransactionNameSearchBar
                                      organization={organization}
                                      eventView={eventView}
                                      onSearch={(query: string) => {
                                        handleSearch(
                                          query,
                                          metricSettingState ?? undefined
                                        );
                                      }}
                                      query={getFreeTextFromQuery(derivedQuery)!}
                                    />
                                  )}
                                </MEPConsumer>
                                <MetricsEventsDropdown />
                              </SearchFilterContainer>
                              {initiallyLoaded ? (
                                <TeamKeyTransactionManager.Provider
                                  organization={organization}
                                  teams={teams}
                                  selectedTeams={['myteams']}
                                  selectedProjects={eventView.project.map(String)}
                                >
                                  <GenericQueryBatcher>
                                    <ViewComponent {...props} />
                                  </GenericQueryBatcher>
                                </TeamKeyTransactionManager.Provider>
                              ) : (
                                <LoadingIndicator />
                              )}
                            </Fragment>
                          )}
                        </MEPSettingProvider>
                      );
                    }}
                  </MetricsDataSwitcher>
                </MetricsCardinalityProvider>
              </TabPanels.Item>
            </TabPanels>
          </Layout.Main>
        </Layout.Body>
      </Tabs>
    </Layout.Page>
  );
}

const SearchContainerWithFilter = styled('div')`
  display: grid;
  grid-template-rows: auto auto;
  gap: ${space(2)};
  margin-bottom: ${space(2)};

  @media (min-width: ${p => p.theme.breakpoints.sm}) {
    grid-template-rows: auto;
    grid-template-columns: auto 1fr;
  }
`;

const SearchContainerWithFilterAndMetrics = styled('div')`
  display: grid;
  grid-template-rows: auto auto auto;
  gap: ${space(2)};
  margin-bottom: ${space(2)};

  @media (min-width: ${p => p.theme.breakpoints.sm}) {
    grid-template-rows: auto;
    grid-template-columns: auto 1fr auto;
  }
`;
