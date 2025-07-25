import {type Theme, useTheme} from '@emotion/react';
import styled from '@emotion/styled';
import type {Location} from 'history';
import * as qs from 'query-string';

import {Link} from 'sentry/components/core/link';
import {Tooltip} from 'sentry/components/core/tooltip';
import type {CursorHandler} from 'sentry/components/pagination';
import Pagination from 'sentry/components/pagination';
import SearchBar from 'sentry/components/searchBar';
import GridEditable, {
  COL_WIDTH_UNDEFINED,
  type GridColumnHeader,
} from 'sentry/components/tables/gridEditable';
import {IconInfo} from 'sentry/icons';
import {t} from 'sentry/locale';
import {space} from 'sentry/styles/space';
import type {Organization} from 'sentry/types/organization';
import type {EventsMetaType} from 'sentry/utils/discover/eventView';
import {getFieldRenderer} from 'sentry/utils/discover/fieldRenderers';
import type {Sort} from 'sentry/utils/discover/fields';
import {RATE_UNIT_TITLE, RateUnit} from 'sentry/utils/discover/fields';
import {VisuallyCompleteWithData} from 'sentry/utils/performanceForSentry';
import {decodeScalar, decodeSorts} from 'sentry/utils/queryString';
import {MutableSearch} from 'sentry/utils/tokenizeSearch';
import {useLocation} from 'sentry/utils/useLocation';
import {useNavigate} from 'sentry/utils/useNavigate';
import useOrganization from 'sentry/utils/useOrganization';
import {renderHeadCell} from 'sentry/views/insights/common/components/tableCells/renderHeadCell';
import {useSpans} from 'sentry/views/insights/common/queries/useDiscover';
import {combineMeta} from 'sentry/views/insights/common/utils/combineMeta';
import {useModuleURL} from 'sentry/views/insights/common/utils/useModuleURL';
import {QueryParameterNames} from 'sentry/views/insights/common/views/queryParameters';
import type {SpanMetricsResponse} from 'sentry/views/insights/types';

type Row = Pick<
  SpanMetricsResponse,
  | 'project.id'
  | 'span.description'
  | 'span.group'
  | 'epm()'
  | 'avg(span.duration)'
  | 'sum(span.duration)'
  | 'sum(ai.total_tokens.used)'
  | 'sum(ai.total_cost)'
>;

type Column = GridColumnHeader<
  | 'span.description'
  | 'epm()'
  | 'avg(span.duration)'
  | 'sum(ai.total_tokens.used)'
  | 'sum(ai.total_cost)'
>;

const COLUMN_ORDER: Column[] = [
  {
    key: 'span.description',
    name: t('AI Pipeline Name'),
    width: COL_WIDTH_UNDEFINED,
  },
  {
    key: 'sum(ai.total_tokens.used)',
    name: t('Total tokens used'),
    width: 180,
  },
  {
    key: 'sum(ai.total_cost)',
    name: t('Total cost'),
    width: 180,
  },
  {
    key: `avg(span.duration)`,
    name: t('Pipeline Duration'),
    width: COL_WIDTH_UNDEFINED,
  },
  {
    key: 'epm()',
    name: `${t('Pipeline runs')} ${RATE_UNIT_TITLE[RateUnit.PER_MINUTE]}`,
    width: COL_WIDTH_UNDEFINED,
  },
];

const SORTABLE_FIELDS = ['sum(ai.total_tokens.used)', 'avg(span.duration)', 'epm()'];

type ValidSort = Sort & {
  field: 'epm()' | 'avg(span.duration)';
};

function isAValidSort(sort: Sort): sort is ValidSort {
  return (SORTABLE_FIELDS as unknown as string[]).includes(sort.field);
}
export function PipelinesTable() {
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const moduleURL = useModuleURL('ai');

  const organization = useOrganization();
  const cursor = decodeScalar(location.query?.[QueryParameterNames.SPANS_CURSOR]);
  const sortField = decodeScalar(location.query?.[QueryParameterNames.SPANS_SORT]);
  const spanDescription = decodeScalar(location.query?.['span.description'], '');

  let sort = decodeSorts(sortField).find(isAValidSort);
  if (!sort) {
    sort = {field: 'epm()', kind: 'desc'};
  }

  const {
    data,
    isPending,
    meta: baseMeta,
    pageLinks,
    error,
  } = useSpans(
    {
      search: MutableSearch.fromQueryObject({
        'span.category': 'ai.pipeline',
        'span.description': spanDescription ? `*${spanDescription}*` : undefined,
      }),
      fields: [
        'span.group',
        'span.description',
        'epm()',
        'avg(span.duration)',
        'sum(span.duration)',
      ],
      sorts: [sort],
      limit: 25,
      cursor,
    },
    'api.ai-pipelines.view'
  );

  const {
    data: tokensUsedData,
    meta: tokensUsedMeta,
    isPending: tokensUsedLoading,
  } = useSpans(
    {
      search: new MutableSearch(
        `span.category:ai span.ai.pipeline.group:[${(data as Row[])
          ?.map(x => x['span.group'])
          ?.filter(x => !!x)
          .join(',')}]`
      ),
      fields: ['span.ai.pipeline.group', 'sum(ai.total_tokens.used)'],
    },
    'api.performance.ai-analytics.token-usage-chart'
  );

  const {
    data: tokenCostData,
    meta: tokenCostMeta,
    isPending: tokenCostLoading,
    error: tokenCostError,
  } = useSpans(
    {
      search: new MutableSearch(
        `span.category:ai span.ai.pipeline.group:[${(data as Row[])?.map(x => x['span.group']).join(',')}]`
      ),
      fields: ['span.ai.pipeline.group', 'sum(ai.total_cost)'],
    },
    'api.performance.ai-analytics.token-usage-chart'
  );

  const rows: Row[] = (data as Row[]).map(baseRow => {
    const row: Row = {
      ...baseRow,
      'sum(ai.total_tokens.used)': 0,
      'sum(ai.total_cost)': 0,
    };
    if (!tokensUsedLoading) {
      const tokenUsedDataPoint = tokensUsedData.find(
        tokenRow => tokenRow['span.ai.pipeline.group'] === row['span.group']
      );
      if (tokenUsedDataPoint) {
        row['sum(ai.total_tokens.used)'] =
          tokenUsedDataPoint['sum(ai.total_tokens.used)'];
      }
    }
    if (!tokenCostLoading && !tokenCostError) {
      const tokenCostDataPoint = tokenCostData.find(
        tokenRow => tokenRow['span.ai.pipeline.group'] === row['span.group']
      );
      if (tokenCostDataPoint) {
        row['sum(ai.total_cost)'] = tokenCostDataPoint['sum(ai.total_cost)'];
      }
    }
    return row;
  });

  const meta = combineMeta(baseMeta, tokensUsedMeta, tokenCostMeta);

  const handleCursor: CursorHandler = (newCursor, pathname, query) => {
    navigate({
      pathname,
      query: {...query, [QueryParameterNames.SPANS_CURSOR]: newCursor},
    });
  };

  const handleSearch = (newQuery: string) => {
    navigate({
      ...location,
      query: {
        ...location.query,
        'span.description': newQuery === '' ? undefined : newQuery,
        [QueryParameterNames.SPANS_CURSOR]: undefined,
      },
    });
  };

  return (
    <VisuallyCompleteWithData
      id="PipelinesTable"
      hasData={rows.length > 0}
      isLoading={isPending}
    >
      <Container>
        <SearchBar
          placeholder={t('Search for pipeline')}
          query={spanDescription}
          onSearch={handleSearch}
        />
        <GridEditable
          isLoading={isPending}
          error={error}
          data={rows}
          columnOrder={COLUMN_ORDER}
          columnSortBy={[
            {
              key: sort.field,
              order: sort.kind,
            },
          ]}
          grid={{
            renderHeadCell: column =>
              renderHeadCell({
                column,
                sort,
                location,
                sortParameterName: QueryParameterNames.SPANS_SORT,
              }),
            renderBodyCell: (column, row) =>
              renderBodyCell(moduleURL, column, row, meta, location, organization, theme),
          }}
        />
        <Pagination pageLinks={pageLinks} onCursor={handleCursor} />
      </Container>
    </VisuallyCompleteWithData>
  );
}

function renderBodyCell(
  moduleURL: string,
  column: Column,
  row: Row,
  meta: EventsMetaType | undefined,
  location: Location,
  organization: Organization,
  theme: Theme
) {
  if (column.key === 'span.description') {
    if (!row['span.description']) {
      return <span>(unknown)</span>;
    }
    if (!row['span.group']) {
      return <span>{row['span.description']}</span>;
    }

    const queryString = {
      ...location.query,
      'span.description': row['span.description'],
    };

    return (
      <Link
        to={`${moduleURL}/pipeline-type/${row['span.group']}?${qs.stringify(queryString)}`}
      >
        {row['span.description']}
      </Link>
    );
  }
  if (column.key === 'sum(ai.total_cost)') {
    const cost = row[column.key];
    if (cost) {
      return <span>US ${cost.toFixed(3)}</span>;
    }
    return (
      <span>
        Unknown{' '}
        <Tooltip
          title={t(
            "Cost is calculated for some of the most popular models, but some providers aren't yet supported."
          )}
          isHoverable
        >
          <IconInfo size="xs" />
        </Tooltip>
      </span>
    );
  }

  if (!meta || !meta?.fields) {
    return row[column.key];
  }

  const renderer = getFieldRenderer(column.key, meta.fields, false);

  const rendered = renderer(row, {
    location,
    organization,
    unit: meta.units?.[column.key],
    theme,
  });

  return rendered;
}

const Container = styled('div')`
  display: flex;
  flex-direction: column;
  gap: ${space(1)};
`;
