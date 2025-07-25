import type {SelectOption} from 'sentry/components/core/compactSelect';
import {MutableSearch} from 'sentry/utils/tokenizeSearch';
import {useLocalStorageState} from 'sentry/utils/useLocalStorageState';
import {useSpans} from 'sentry/views/insights/common/queries/useDiscover';
import {
  DATABASE_SYSTEM_TO_LABEL,
  SupportedDatabaseSystem,
} from 'sentry/views/insights/database/utils/constants';
import {SpanMetricsField} from 'sentry/views/insights/types';

export function useSystemSelectorOptions() {
  const [selectedSystem, setSelectedSystem] = useLocalStorageState<string | undefined>(
    'insights-db-system-selector',
    undefined
  );

  const {data, isPending, isError} = useSpans(
    {
      search: MutableSearch.fromQueryObject({'span.op': 'db'}),

      fields: [SpanMetricsField.SPAN_SYSTEM, 'count()'],
      sorts: [{field: 'count()', kind: 'desc'}],
    },
    'api.starfish.database-system-selector'
  );

  const options: Array<SelectOption<string>> = [];
  data.forEach(entry => {
    const system = entry['span.system'];
    if (system) {
      const textValue =
        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        system in DATABASE_SYSTEM_TO_LABEL ? DATABASE_SYSTEM_TO_LABEL[system] : system;

      const supportedSystemSet: Set<string> = new Set(
        Object.values(SupportedDatabaseSystem)
      );

      if (supportedSystemSet.has(system)) {
        options.push({value: system, label: textValue, textValue});
      }
    }
  });

  // Edge case: Invalid DB system was retrieved from localStorage
  if (!options.some(option => selectedSystem === option.value) && options.length > 0) {
    setSelectedSystem(options[0]!.value);
  }

  // Edge case: No current system is saved in localStorage
  if (!selectedSystem && options.length > 0) {
    setSelectedSystem(options[0]!.value);
  }

  return {selectedSystem, setSelectedSystem, options, isLoading: isPending, isError};
}
