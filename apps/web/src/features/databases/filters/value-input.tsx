/**
 * The value half of a filter rule (Databases spec 3.4). What to type or pick follows the property
 * and the condition (filterValueKind in the package): text, a number, options, status groups,
 * people with "Me" first, related rows, or a date (date-input.tsx).
 */
import {
  ME,
  parseNumberText,
  type EvalContext,
  type FilterCondition,
  type FilterValue,
  type Id,
  type Property,
  type SelectOption,
  type StatusGroup,
} from '@carehub/databases';
import { filterValueKind } from '@carehub/databases/filter';
import { STATUS_GROUP_LABELS } from '@carehub/databases/group';
import { formatValue, parseTyped } from '@carehub/databases/values';
import { Avatar, Checkbox, Input } from '@carehub/ui';
import { useId, useState, type ReactNode } from 'react';
import { OptionChip, type PersonChoice } from '../cells';
import { usePickRows } from '../hooks';
import { DateRangeValue, DateValue, WindowValue } from './date-input';
import { useDraft } from './draft';
import { FILTER_TEXT } from './messages';

export interface ValueInputProps {
  rule: FilterCondition;
  property: Property;
  ctx: EvalContext;
  /** People to pick besides "Me". */
  people: readonly PersonChoice[];
  /** Undefined clears the value. */
  onChange(value: FilterValue | undefined): void;
}

/** The input for a rule's value; nothing for conditions without one ("Is ticked", "Is empty"). */
export function ValueInput(props: ValueInputProps) {
  const { rule, property } = props;
  switch (filterValueKind(property, rule.op)) {
    case 'text':
      return <TextValue {...props} />;
    case 'number':
      return <NumberValue {...props} />;
    case 'options':
      return <OptionsValue {...props} />;
    case 'status_groups':
      return <StatusGroupsValue {...props} />;
    case 'people':
      return <PeopleValue {...props} />;
    case 'rows':
      return <RowsValue {...props} />;
    case 'date':
      return <DateValue value={rule.value} onChange={props.onChange} />;
    case 'date_range':
      return <DateRangeValue value={rule.value} onChange={props.onChange} />;
    case 'date_window':
      return <WindowValue value={rule.value} onChange={props.onChange} />;
    case 'none':
      return null;
  }
}

// ---------------------------------------------------------------- typed values

function TextValue({ rule, onChange }: ValueInputProps) {
  const saved = typeof rule.value === 'string' ? rule.value : '';
  const { draft, setDraft, flush, onKeyDown } = useDraft(saved, (text) => onChange(text));
  return (
    <Input
      aria-label={FILTER_TEXT.value}
      placeholder={FILTER_TEXT.value}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={flush}
      onKeyDown={onKeyDown}
    />
  );
}

/** "Enter a number." or the exact decimal the filter keeps (percent and currency aware). */
function parseNumber(property: Property, text: string, ctx: EvalContext): string | null {
  if (property.config.type === 'number') {
    const result = parseTyped(property, text, ctx.viewer);
    return result.ok && typeof result.value === 'string' ? result.value : null;
  }
  return parseNumberText(text);
}

function NumberValue({ rule, property, ctx, onChange }: ValueInputProps) {
  const errorId = useId();
  const [error, setError] = useState(false);
  const saved =
    typeof rule.value !== 'string'
      ? ''
      : property.config.type === 'number'
        ? formatValue(property, rule.value, ctx)
        : rule.value;
  const { draft, setDraft, flush, onKeyDown } = useDraft(saved, (text) => {
    if (!text.trim()) {
      setError(false);
      onChange(undefined);
      return;
    }
    const value = parseNumber(property, text, ctx);
    setError(value === null);
    if (value !== null) onChange(value);
  });
  return (
    <div className="flex flex-col gap-1">
      <Input
        aria-label={FILTER_TEXT.value}
        placeholder={FILTER_TEXT.value}
        inputMode="decimal"
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
      {error && (
        <p id={errorId} className="text-label text-danger">
          {FILTER_TEXT.enterNumber}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- picking from a list

const idsOf = (v: FilterValue | undefined): Id[] =>
  Array.isArray(v) ? v.filter((x): x is Id => typeof x === 'string') : [];

/** A list of ticks; the value keeps the list's order. */
function TickList({
  label,
  items,
  picked,
  onChange,
  empty,
}: {
  label: string;
  items: readonly { id: Id; content: ReactNode }[];
  picked: readonly Id[];
  onChange(ids: Id[]): void;
  empty?: string;
}) {
  const base = useId();
  const chosen = new Set(picked);
  const toggle = (id: Id, on: boolean) => {
    const next = new Set(chosen);
    if (on) next.add(id);
    else next.delete(id);
    onChange(items.map((item) => item.id).filter((itemId) => next.has(itemId)));
  };
  if (!items.length && empty) return <p className="text-small text-muted">{empty}</p>;
  return (
    <ul aria-label={label} className="flex max-h-64 flex-col gap-1 overflow-y-auto">
      {items.map((item, i) => {
        const id = `${base}-${i}`;
        return (
          <li key={item.id} className="flex min-w-0 items-center gap-2">
            <Checkbox
              id={id}
              aria-labelledby={`${id}-label`}
              checked={chosen.has(item.id)}
              onCheckedChange={(on) => toggle(item.id, on === true)}
            />
            <label id={`${id}-label`} htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
              {item.content}
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function optionsOf(property: Property): readonly SelectOption[] {
  const config = property.config;
  return 'options' in config ? config.options : [];
}

function OptionsValue({ rule, property, onChange }: ValueInputProps) {
  const status = property.config.type === 'status';
  const items = optionsOf(property).map((option) => ({
    id: option.id,
    content: <OptionChip option={option} status={status} />,
  }));
  return (
    <TickList
      label={FILTER_TEXT.value}
      items={items}
      picked={idsOf(rule.value)}
      onChange={(ids) => onChange(ids)}
      empty={FILTER_TEXT.noMatches}
    />
  );
}

const STATUS_GROUPS: readonly StatusGroup[] = ['todo', 'in_progress', 'complete'];

function StatusGroupsValue({ rule, onChange }: ValueInputProps) {
  const items = STATUS_GROUPS.map((group) => ({
    id: group,
    content: <span className="text-small text-fg">{STATUS_GROUP_LABELS[group]}</span>,
  }));
  return (
    <TickList
      label={FILTER_TEXT.value}
      items={items}
      picked={idsOf(rule.value)}
      onChange={(ids) => onChange(ids as StatusGroup[])}
    />
  );
}

function Person({ name, avatar }: { name: string; avatar?: string | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-small text-fg">
      <Avatar name={name} src={avatar} size="sm" decorative />
      <span className="truncate">{name}</span>
    </span>
  );
}

function PeopleValue({ rule, ctx, people, onChange }: ValueInputProps) {
  const picked = idsOf(rule.value);
  const known = new Set(people.map((p) => p.id));
  // People already in the rule who aren't in the list (removed members) stay pickable.
  const others = picked.filter((id) => id !== ME && !known.has(id));
  const items = [
    { id: ME, content: <Person name={FILTER_TEXT.me} /> },
    ...people.map((p) => ({ id: p.id, content: <Person name={p.name} avatar={p.avatarUrl} /> })),
    ...others.map((id) => ({
      id,
      content: <Person name={ctx.userName(id) ?? FILTER_TEXT.unknownPerson} />,
    })),
  ];
  return (
    <TickList
      label={FILTER_TEXT.value}
      items={items}
      picked={picked}
      onChange={(ids) => onChange(ids)}
    />
  );
}

const rowItems = (rows: readonly { id: Id; title: string | undefined }[]) =>
  rows.map(({ id, title }) => ({
    id,
    content: <span className="truncate text-small text-fg">{title || FILTER_TEXT.untitled}</span>,
  }));

/** Related rows: the ones in the rule, then rows of the other database found by a search. */
function RowsValue(props: ValueInputProps) {
  const { rule, property, ctx, onChange } = props;
  const config = property.config;
  if (config.type === 'relation')
    return <RelationRows {...props} target={config.targetDatabaseId} />;
  // Formulas and rollups that list rows: only the rows already in the rule can be unticked.
  const picked = idsOf(rule.value);
  return (
    <TickList
      label={FILTER_TEXT.value}
      items={rowItems(picked.map((id) => ({ id, title: ctx.rowTitle?.(id) })))}
      picked={picked}
      onChange={(ids) => onChange(ids)}
      empty={FILTER_TEXT.noMatches}
    />
  );
}

function RelationRows({ rule, ctx, onChange, target }: ValueInputProps & { target: Id }) {
  const [q, setQ] = useState('');
  const found = usePickRows(target, q.trim());
  const picked = idsOf(rule.value);
  const results = found.data ?? [];
  // Picked rows first (named from the view's titles or the search), then the other matches.
  const items = rowItems([
    ...picked.map((id) => ({
      id,
      title: ctx.rowTitle?.(id) ?? results.find((row) => row.id === id)?.title,
    })),
    ...results
      .filter((row) => !picked.includes(row.id))
      .map((row) => ({ id: row.id, title: row.title })),
  ]);
  return (
    <div className="flex flex-col gap-2">
      <Input
        type="search"
        aria-label={FILTER_TEXT.searchRows}
        placeholder={FILTER_TEXT.searchRows}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <TickList
        label={FILTER_TEXT.value}
        items={items}
        picked={picked}
        onChange={(ids) => onChange(ids)}
        empty={FILTER_TEXT.noMatches}
      />
    </div>
  );
}
