import { useMemo } from 'react';
import type { ChatListResponse } from '@carehub/team-chat';
import {
  Button,
  cn,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@carehub/ui';
import {
  anyFilter,
  DATE_CHOICES,
  dateLabel,
  fromChoices,
  HAS_CHOICES,
  inChoices,
  NO_FILTERS,
  type SearchFilters,
} from './search';

/** The filters' "no filter" choice (a Select item can't have an empty value). */
const ANY = 'any';

interface FilterSelectProps<V extends string> {
  name: string;
  value: V | null;
  choices: readonly { value: V; label: string }[];
  /** The "no filter" choice, such as "Anyone". */
  anyLabel: string;
  /** The button's text when a choice is picked, if not the choice's own. */
  shown?: string;
  onChange(value: V | null): void;
  testId: string;
}

function FilterSelect<V extends string>({
  name,
  value,
  choices,
  anyLabel,
  shown,
  onChange,
  testId,
}: FilterSelectProps<V>) {
  const current = choices.find((choice) => choice.value === value);
  return (
    <Select
      value={current ? current.value : ANY}
      onValueChange={(picked) =>
        onChange(choices.find((choice) => choice.value === picked)?.value ?? null)
      }
    >
      <SelectTrigger
        aria-label={`${name}: ${current?.label ?? anyLabel}`}
        className={cn('h-8 w-auto max-w-40 gap-1 px-2', current && 'border-primary')}
        data-testid={testId}
      >
        <SelectValue>{current ? (shown ?? current.label) : name}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {choices.map((choice) => (
          <SelectItem key={choice.value} value={choice.value}>
            {choice.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const DAY_CHOICES = new Set(['on', 'before', 'after', 'between']);

/** The From, In, Date and Has filters under the search box; some dates ask for days. */
export function SearchFilterBar({
  id,
  answer,
  filters,
  onChange,
}: {
  id: string;
  answer: ChatListResponse | null | undefined;
  filters: SearchFilters;
  onChange(filters: SearchFilters): void;
}) {
  const people = useMemo(() => fromChoices(answer), [answer]);
  const chats = useMemo(() => inChoices(answer), [answer]);
  const set = (change: Partial<SearchFilters>) => onChange({ ...filters, ...change });
  return (
    <div id={id} className="flex flex-col gap-2" data-testid="messages-search-filters">
      <div className="flex flex-wrap items-center gap-1">
        <FilterSelect
          name="From"
          value={filters.fromUserId}
          choices={people}
          anyLabel="Anyone"
          onChange={(fromUserId) => set({ fromUserId })}
          testId="messages-filter-from"
        />
        <FilterSelect
          name="In"
          value={filters.chatId}
          choices={chats}
          anyLabel="All chats"
          onChange={(chatId) => set({ chatId })}
          testId="messages-filter-in"
        />
        <FilterSelect
          name="Date"
          value={filters.date === 'any' ? null : filters.date}
          choices={DATE_CHOICES.slice(1)}
          anyLabel="Any time"
          shown={dateLabel(filters)}
          onChange={(date) => set({ date: date ?? 'any' })}
          testId="messages-filter-date"
        />
        <FilterSelect
          name="Has"
          value={filters.has}
          choices={HAS_CHOICES}
          anyLabel="Anything"
          onChange={(has) => set({ has })}
          testId="messages-filter-has"
        />
        {anyFilter(filters) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>
      {DAY_CHOICES.has(filters.date) && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            aria-label={filters.date === 'between' ? 'First day' : 'Day'}
            value={filters.day}
            onChange={(event) => set({ day: event.target.value })}
            className="h-8"
            data-testid="messages-filter-day"
          />
          {filters.date === 'between' && (
            <>
              <span className="text-small text-muted">to</span>
              <Input
                type="date"
                aria-label="Last day"
                value={filters.lastDay}
                onChange={(event) => set({ lastDay: event.target.value })}
                className="h-8"
                data-testid="messages-filter-last-day"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
