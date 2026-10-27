import {
  Button,
  Card,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  VisuallyHidden,
  cn,
} from '@carehub/ui';
import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { usePageTitle } from '../../lib/usePageTitle';
import { useFilters, useOverview, type Overview, type OverviewQuery } from './api';
import { dayText, todayIn } from './format';
import { OverviewNumbers } from './overview';
import {
  PRESETS,
  RANGE_LABELS,
  customRangeProblem,
  rangeChoice,
  readQuery,
  writeQuery,
  type RangeChoice,
} from './range';

/** The Select value for "everyone" and "all spaces" (Select values can't be empty). */
const ALL = 'all';

const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function CustomRange({
  query,
  overview,
  onChange,
}: {
  query: OverviewQuery;
  overview: Overview | undefined;
  onChange: (range: { from: string; to: string }) => void;
}) {
  const today = todayIn(overview?.timeZone ?? browserTimeZone());
  const keptFrom = overview?.keptFrom ?? '';
  const [range, setRange] = useState({
    from: query.from ?? overview?.range.from ?? today,
    to: query.to ?? overview?.range.to ?? today,
  });
  const problem = customRangeProblem(range.from, range.to, { keptFrom, today });
  const problemId = useId();

  const change = (next: { from: string; to: string }) => {
    setRange(next);
    if (!customRangeProblem(next.from, next.to, { keptFrom, today })) onChange(next);
  };
  const inputProps = {
    type: 'date',
    min: keptFrom || undefined,
    max: today,
    'aria-invalid': problem ? true : undefined,
    'aria-describedby': problem ? problemId : undefined,
  } as const;

  return (
    <div className="flex flex-col gap-2" data-testid="analytics-custom-range">
      <div className="flex flex-wrap gap-4">
        <Field label="From">
          <Input
            {...inputProps}
            value={range.from}
            onChange={(event) => change({ ...range, from: event.target.value })}
          />
        </Field>
        <Field label="To">
          <Input
            {...inputProps}
            value={range.to}
            onChange={(event) => change({ ...range, to: event.target.value })}
          />
        </Field>
      </div>
      <p id={problemId} role="alert" className="text-small text-danger">
        {problem}
      </p>
    </div>
  );
}

function FilterSelect({
  label,
  everyone,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  everyone: string;
  value: string | undefined;
  options: readonly { id: string; name: string }[];
  onChange: (id: string | undefined) => void;
  testId: string;
}) {
  return (
    <Field label={label} className="min-w-44">
      <Select
        value={value ?? ALL}
        onValueChange={(next) => onChange(next === ALL ? undefined : next)}
      >
        <SelectTrigger data-testid={testId}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{everyone}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function OverviewSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-4" data-testid="analytics-loading">
      <VisuallyHidden>Loading Analytics…</VisuallyHidden>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        {[0, 1, 2, 3].map((n) => (
          <Skeleton key={n} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-72" />
      <Skeleton className="h-72" />
    </div>
  );
}

function LoadError({
  error,
  retry,
  retrying,
}: {
  error: Error;
  retry: () => void;
  retrying: boolean;
}) {
  // Only Admins see Analytics (AN-D1); asking again won't change a refusal.
  const refused = error instanceof ApiError && (error.status === 401 || error.status === 403);
  return (
    <Card className="flex flex-wrap items-center gap-3" data-testid="analytics-error">
      <p role="alert" className={cn(!refused && 'text-danger')}>
        {refused ? error.message : `Analytics didn't load. ${error.message}`}
      </p>
      {!refused && (
        <Button variant="secondary" size="sm" loading={retrying} onClick={retry}>
          Retry
        </Button>
      )}
    </Card>
  );
}

/**
 * /analytics: who opened and edited which pages and when, for Admins (Analytics spec). Overview
 * for the last 7 days unless the person picks 30 or 90 days or their own dates, by person and space.
 */
export function AnalyticsScreen() {
  usePageTitle('Analytics');
  const [params, setParams] = useSearchParams();
  const query = readQuery(params);
  const overview = useOverview(query);
  const filters = useFilters();
  const data = overview.data;
  // Custom range chosen, before its dates are: the address still has the old range.
  const [pickingDates, setPickingDates] = useState(false);
  const choice: RangeChoice = pickingDates ? 'custom' : rangeChoice(query);

  const update = (changes: Partial<OverviewQuery>) =>
    setParams(writeQuery({ ...query, ...changes }), { replace: true });

  const chooseRange = (next: RangeChoice) => {
    setPickingDates(next === 'custom');
    if (next !== 'custom') update({ days: next, from: undefined, to: undefined });
  };

  return (
    <main
      className="mx-auto flex w-full max-w-page flex-col gap-4 px-4 py-8"
      data-testid="analytics-screen"
    >
      <h1 className="text-title">Analytics</h1>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="Date range" className="min-w-44">
            <Select value={choice} onValueChange={(next) => chooseRange(next as RangeChoice)}>
              <SelectTrigger data-testid="analytics-range">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...PRESETS, 'custom' as const].map((value) => (
                  <SelectItem key={value} value={value}>
                    {RANGE_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <FilterSelect
            label="Space"
            everyone="All spaces"
            value={query.space}
            options={filters.data?.spaces ?? []}
            onChange={(space) => update({ space })}
            testId="analytics-filter-space"
          />
          <FilterSelect
            label="Person"
            everyone="Everyone"
            value={query.person}
            options={filters.data?.people ?? []}
            onChange={(person) => update({ person })}
            testId="analytics-filter-person"
          />
        </div>
        {choice === 'custom' && (
          <CustomRange query={query} overview={data} onChange={(range) => update(range)} />
        )}
        <p className="text-small text-muted" data-testid="analytics-kept-note">
          Activity older than 1 year is deleted.
          {data && ` Analytics goes back to ${dayText(data.keptFrom)}.`}
          {data && ` Days follow your time zone, ${data.timeZone}.`}
        </p>
      </div>
      {overview.isError && !data && (
        <LoadError
          error={overview.error}
          retry={() => void overview.refetch()}
          retrying={overview.isFetching}
        />
      )}
      {overview.isPending && <OverviewSkeleton />}
      {data && (
        <div
          className={cn('flex flex-col gap-4', overview.isPlaceholderData && 'opacity-60')}
          aria-busy={overview.isPlaceholderData}
        >
          <OverviewNumbers overview={data} />
        </div>
      )}
    </main>
  );
}
