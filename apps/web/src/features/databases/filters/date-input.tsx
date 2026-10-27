/**
 * Date values for filter rules (Databases spec 3.4): a relative day ("Today", "One week ago") or an
 * exact date for "Is", "Is before" and the like; two of them for "Is between"; and a window for "Is
 * within", named ("This week", "Past 30 days") or custom ("Next 3 months").
 */
import type { DateRef, DateWindow, FilterValue, RelativeDay } from '@carehub/databases';
import { MAX_WINDOW_COUNT } from '@carehub/databases/schemas';
import { Input } from '@carehub/ui';
import { useId, useState } from 'react';
import { NativeSelect } from '../cells/controls';
import { useDraft } from './draft';
import { FILTER_TEXT, RELATIVE_DAY_LABELS, WINDOW_LABELS, WINDOW_UNIT_LABELS } from './messages';

/** What each date input gets: the rule's value and where a new one goes (undefined clears it). */
export interface DateInputProps {
  value: FilterValue | undefined;
  onChange(value: FilterValue | undefined): void;
}

const RELATIVE_DAYS = Object.keys(RELATIVE_DAY_LABELS) as RelativeDay[];
const EXACT = 'exact';

export function isDateRef(v: unknown): v is DateRef {
  return (
    typeof v === 'object' &&
    v !== null &&
    (('relative' in v && typeof v.relative === 'string') ||
      ('exact' in v && typeof v.exact === 'string'))
  );
}

/** "Is", "Is before" and the like: one date. */
export function DateValue({ value, onChange }: DateInputProps) {
  return (
    <DateRefInput
      label={FILTER_TEXT.date}
      value={isDateRef(value) ? value : null}
      onChange={onChange}
    />
  );
}

/** A relative day ("Today", "One week ago"...) or "Exact date" with a date field. */
function DateRefInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: DateRef | null;
  onChange(value: DateRef | undefined): void;
}) {
  const [exactMode, setExactMode] = useState(value !== null && 'exact' in value);
  const exact = value !== null && 'exact' in value ? value.exact : '';
  const choice =
    value !== null && 'relative' in value
      ? value.relative
      : value !== null || exactMode
        ? EXACT
        : '';
  return (
    <div className="flex flex-col gap-2">
      <NativeSelect
        aria-label={label}
        value={choice}
        onChange={(e) => {
          const next = e.target.value;
          if (next === EXACT) {
            setExactMode(true);
            onChange(exact ? { exact } : undefined);
          } else if (next) {
            setExactMode(false);
            onChange({ relative: next as RelativeDay });
          }
        }}
      >
        <option value="" disabled>
          {FILTER_TEXT.chooseDate}
        </option>
        {RELATIVE_DAYS.map((day) => (
          <option key={day} value={day}>
            {RELATIVE_DAY_LABELS[day]}
          </option>
        ))}
        <option value={EXACT}>{FILTER_TEXT.exactDate}</option>
      </NativeSelect>
      {choice === EXACT && (
        <Input
          type="date"
          aria-label={`${label}: ${FILTER_TEXT.exactDate}`}
          value={exact}
          onChange={(e) => onChange(e.target.value ? { exact: e.target.value } : undefined)}
        />
      )}
    </div>
  );
}

export function DateRangeValue({ value: v, onChange }: DateInputProps) {
  const range =
    typeof v === 'object' && v !== null && 'start' in v && isDateRef(v.start) && isDateRef(v.end)
      ? v
      : null;
  // A range needs both ends: until it has them, the end follows the start.
  const set = (end: 'start' | 'end', ref: DateRef | undefined) => {
    if (!ref) return onChange(undefined);
    const other = range ? range[end === 'start' ? 'end' : 'start'] : ref;
    onChange(end === 'start' ? { start: ref, end: other } : { start: other, end: ref });
  };
  return (
    <div className="flex flex-col gap-2">
      <DateRefInput
        label={FILTER_TEXT.start}
        value={range?.start ?? null}
        onChange={(ref) => set('start', ref)}
      />
      <DateRefInput
        label={FILTER_TEXT.end}
        value={range?.end ?? null}
        onChange={(ref) => set('end', ref)}
      />
    </div>
  );
}

type NamedWindow = Extract<DateWindow, string>;
type CustomWindow = Exclude<DateWindow, string>;
const NAMED_WINDOWS = Object.keys(WINDOW_LABELS) as NamedWindow[];
const UNITS = Object.keys(WINDOW_UNIT_LABELS) as CustomWindow['unit'][];
const CUSTOM = 'custom';
const NEW_CUSTOM: CustomWindow = { direction: 'past', count: 1, unit: 'week' };

function isCustomWindow(v: unknown): v is CustomWindow {
  return typeof v === 'object' && v !== null && 'unit' in v && 'count' in v && 'direction' in v;
}

/** "Is within": a named window ("This week", "Past 30 days") or a custom one ("Next 3 months"). */
export function WindowValue({ value: v, onChange }: DateInputProps) {
  const named = typeof v === 'string' && Object.hasOwn(WINDOW_LABELS, v) ? (v as NamedWindow) : '';
  const custom = isCustomWindow(v) ? v : null;
  const choice = custom ? CUSTOM : named;
  return (
    <div className="flex flex-col gap-2">
      <NativeSelect
        aria-label={FILTER_TEXT.window}
        value={choice}
        onChange={(e) => {
          const next = e.target.value;
          if (next === CUSTOM) onChange(custom ?? NEW_CUSTOM);
          else if (next) onChange(next as NamedWindow);
        }}
      >
        <option value="" disabled>
          {FILTER_TEXT.chooseDate}
        </option>
        {NAMED_WINDOWS.map((w) => (
          <option key={w} value={w}>
            {WINDOW_LABELS[w]}
          </option>
        ))}
        <option value={CUSTOM}>{FILTER_TEXT.custom}</option>
      </NativeSelect>
      {custom && <CustomWindowInput window={custom} onChange={onChange} />}
    </div>
  );
}

function CustomWindowInput({
  window,
  onChange,
}: {
  window: CustomWindow;
  onChange(value: CustomWindow): void;
}) {
  const errorId = useId();
  const [error, setError] = useState(false);
  const { draft, setDraft, flush, onKeyDown } = useDraft(String(window.count), (text) => {
    const count = Number(text.trim());
    const fits = /^\d+$/.test(text.trim()) && count >= 1 && count <= MAX_WINDOW_COUNT;
    setError(!fits);
    if (fits) onChange({ ...window, count });
  });
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label={FILTER_TEXT.direction}
          value={window.direction}
          onChange={(e) =>
            onChange({ ...window, direction: e.target.value === 'next' ? 'next' : 'past' })
          }
        >
          <option value="past">{FILTER_TEXT.past}</option>
          <option value="next">{FILTER_TEXT.next}</option>
        </NativeSelect>
        <Input
          aria-label={FILTER_TEXT.count}
          inputMode="numeric"
          value={draft}
          aria-invalid={error || undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(false);
          }}
          onBlur={flush}
          onKeyDown={onKeyDown}
        />
        <NativeSelect
          aria-label={FILTER_TEXT.unit}
          value={window.unit}
          onChange={(e) => {
            const unit = UNITS.find((u) => u === e.target.value);
            if (unit) onChange({ ...window, unit });
          }}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {window.count === 1 ? WINDOW_UNIT_LABELS[unit][0] : WINDOW_UNIT_LABELS[unit][1]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {error && (
        <p id={errorId} className="text-label text-danger">
          {FILTER_TEXT.windowCount}
        </p>
      )}
    </div>
  );
}
