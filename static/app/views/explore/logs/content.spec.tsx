import {initializeOrg} from 'sentry-test/initializeOrg';
import {render, screen, userEvent, waitFor} from 'sentry-test/reactTestingLibrary';

import PageFiltersStore from 'sentry/stores/pageFiltersStore';

import LogsPage from './content';

const BASE_FEATURES = ['ourlogs-enabled', 'ourlogs-visualize-sidebar'];

describe('LogsPage', function () {
  const {organization, project} = initializeOrg({
    organization: {
      features: BASE_FEATURES,
    },
  });

  PageFiltersStore.init();
  PageFiltersStore.onInitializeUrlState(
    {
      projects: [project].map(p => parseInt(p.id, 10)),
      environments: [],
      datetime: {period: '12h', start: null, end: null, utc: null},
    },
    new Set()
  );

  let eventTableMock: jest.Mock;
  let eventStatsMock: jest.Mock;
  beforeEach(function () {
    organization.features = BASE_FEATURES;
    MockApiClient.clearMockResponses();
    eventTableMock = MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/events/`,
      method: 'GET',
      body: {
        data: [
          {
            'sentry.item_id': '019621262d117e03bce898cb8f4f6ff7',
            'project.id': 1,
            trace: '17cc0bae407042eaa4bf6d798c37d026',
            severity_number: 9,
            severity_text: 'info',
            timestamp: '2025-04-10T19:21:12+00:00',
            message: 'some log message1',
            'tags[sentry.timestamp_precise,number]': 1.7443128722090732e18,
          },
          {
            'sentry.item_id': '0196212624a17144aa392d01420256a2',
            'project.id': 1,
            trace: 'c331c2df93d846f5a2134203416d40bb',
            severity_number: 9,
            severity_text: 'info',
            timestamp: '2025-04-10T19:21:10+00:00',
            message: 'some log message2',
            'tags[sentry.timestamp_precise,number]': 1.744312870049196e18,
          },
        ],
        meta: {
          fields: {
            'sentry.item_id': 'string',
            'project.id': 'string',
            trace: 'string',
            severity_number: 'integer',
            severity_text: 'string',
            timestamp: 'string',
            message: 'string',
            'tags[sentry.timestamp_precise,number]': 'number',
          },
          units: {},
        },
      },
    });

    eventStatsMock = MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/events-stats/`,
      method: 'GET',
      body: {},
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/releases/stats/`,
      method: 'GET',
      body: {},
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/recent-searches/`,
      method: 'GET',
      body: [],
    });

    MockApiClient.addMockResponse({
      url: `/subscriptions/${organization.slug}/`,
      method: 'GET',
      body: {},
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${organization.slug}/trace-items/attributes/`,
      method: 'GET',
      body: [],
    });
  });

  it('should call APIs as expected', async function () {
    render(<LogsPage />, {
      organization,
      initialRouterConfig: {
        location: `/organizations/${organization.slug}/explore/logs/`,
      },
    });

    await waitFor(() => {
      expect(eventTableMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(eventStatsMock).toHaveBeenCalled();
    });

    const table = screen.getByTestId('logs-table');
    expect(await screen.findByText('some log message1')).toBeInTheDocument();
    expect(table).not.toHaveTextContent(/auto refresh/i);
    expect(table).toHaveTextContent(/some log message1/);
    expect(table).toHaveTextContent(/some log message2/);
  });

  it('should call aggregates APIs as expected', async function () {
    render(<LogsPage />, {
      organization,
      initialRouterConfig: {
        location: `/organizations/${organization.slug}/explore/logs/`,
      },
    });

    await waitFor(() => {
      expect(eventTableMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(eventStatsMock).toHaveBeenCalled();
    });

    eventTableMock.mockClear();
    eventStatsMock.mockClear();

    await userEvent.click(screen.getByRole('button', {name: 'Expand sidebar'}));
    await userEvent.click(screen.getByRole('button', {name: 'None'}));
    await userEvent.click(screen.getByRole('option', {name: 'severity'}));
    await userEvent.click(screen.getByRole('tab', {name: 'Aggregates'}));

    await waitFor(() => {
      expect(eventTableMock).toHaveBeenCalledWith(
        `/organizations/${organization.slug}/events/`,
        expect.objectContaining({
          query: expect.objectContaining({
            environment: [],
            statsPeriod: '24h',
            dataset: 'ourlogs',
            field: ['severity', 'count(message)'],
            sort: '-count(message)',
          }),
        })
      );
    });

    await waitFor(() => {
      expect(eventStatsMock).toHaveBeenCalledWith(
        `/organizations/${organization.slug}/events-stats/`,
        expect.objectContaining({
          query: expect.objectContaining({
            environment: [],
            statsPeriod: '24h',
            dataset: 'ourlogs',
            field: ['severity', 'count(message)'],
            yAxis: 'count(message)',
            orderby: '-count_message',
            interval: '5m',
          }),
        })
      );
    });
  });

  it('enables autorefresh when Switch is clicked', async function () {
    const {organization: newOrganization} = initializeOrg({
      organization: {
        features: [...BASE_FEATURES, 'ourlogs-infinite-scroll', 'ourlogs-live-refresh'],
      },
    });

    MockApiClient.addMockResponse({
      url: `/organizations/${newOrganization.slug}/events/`,
      method: 'GET',
      body: {
        data: [
          {
            'sentry.item_id': '1',
            'project.id': 1,
            trace: 'trace1',
            severity_number: 9,
            severity_text: 'info',
            timestamp: '2025-04-10T19:21:12+00:00',
            message: 'some log message',
            'tags[sentry.timestamp_precise,number]': 100,
          },
        ],
        meta: {fields: {}, units: {}},
      },
    });

    render(<LogsPage />, {
      organization: newOrganization,
      initialRouterConfig: {
        location: `/organizations/${newOrganization.slug}/explore/logs/`,
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('logs-table')).toBeInTheDocument();
    });

    const switchInput = screen.getByRole('checkbox', {name: /auto-refresh/i});
    expect(switchInput).not.toBeChecked();
    expect(switchInput).toBeEnabled();

    await userEvent.click(switchInput);

    await waitFor(
      () => {
        expect(switchInput).toBeChecked();
      },
      {timeout: 5000}
    );
  });
});
