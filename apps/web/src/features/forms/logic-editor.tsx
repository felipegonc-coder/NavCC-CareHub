import { useCallback, useId, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, IconButton, Input, VisuallyHidden } from '@carehub/ui';
import {
  LIMITS,
  normalizeDecimal,
  type FormCondition,
  type FormConditionOp,
  type FormDefinition,
  type FormLogic,
  type FormQuestion,
  type Id,
  type Property,
} from '@carehub/databases';
import {
  conditionOpLabel,
  conditionOps,
  conditionProblem,
  questionLabel,
} from '@carehub/databases/forms';
import { useFormsClient } from './api';
import { CommitInput, NativeSelect } from './controls';
import { newCondition, questionsAbove } from './definition';
import { Picker, type PickerOption } from './picker';
import { useSearch } from './questions';

/** Conditions that never take a value. */
const NO_VALUE: ReadonlySet<FormConditionOp> = new Set<FormConditionOp>([
  'is_checked',
  'is_not_checked',
  'is_empty',
  'is_not_empty',
]);

interface Source {
  question: FormQuestion;
  prop: Property;
}

export interface LogicEditorProps {
  def: FormDefinition;
  question: FormQuestion;
  properties: readonly Property[];
  onChange(logic: FormLogic | null): void;
}

/**
 * "Show this question only when…": up to 10 conditions on the questions above, matched by All or
 * Any. A condition still waiting for its value is saved and ignored until it has one.
 */
export function LogicEditor({ def, question, properties, onChange }: LogicEditorProps) {
  const id = useId();
  const logic: FormLogic = question.logic ?? { combinator: 'and', conditions: [] };
  const sources: Source[] = questionsAbove(def, question.propertyId).flatMap((q) => {
    const prop = properties.find((p) => p.id === q.propertyId);
    return prop && conditionOps(prop).length > 0 ? [{ question: q, prop }] : [];
  });
  const first = sources[0];
  const full = logic.conditions.length >= LIMITS.formConditions;
  const set = (conditions: FormCondition[], combinator: FormLogic['combinator']) =>
    onChange({ combinator, conditions });

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-border p-3">
      <legend className="px-1 text-small font-medium text-fg">Show this question only when…</legend>
      <div className="flex items-center gap-2">
        <label htmlFor={`${id}-match`} className="text-small text-muted">
          Match
        </label>
        <NativeSelect
          id={`${id}-match`}
          className="w-auto"
          value={logic.combinator}
          onChange={(event) => set(logic.conditions, event.target.value === 'or' ? 'or' : 'and')}
        >
          <option value="and">All</option>
          <option value="or">Any</option>
        </NativeSelect>
      </div>
      {logic.conditions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {logic.conditions.map((cond, index) => (
            <ConditionRow
              key={cond.id}
              cond={cond}
              index={index}
              sources={sources}
              onChange={(next) =>
                set(
                  logic.conditions.map((c) => (c.id === cond.id ? next : c)),
                  logic.combinator,
                )
              }
              onRemove={() =>
                set(
                  logic.conditions.filter((c) => c.id !== cond.id),
                  logic.combinator,
                )
              }
            />
          ))}
        </ul>
      )}
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={!first || full}
          onClick={() => {
            if (first) set([...logic.conditions, newCondition(first.prop)], logic.combinator);
          }}
        >
          <Plus aria-hidden />
          Add condition
        </Button>
        {full && <p className="text-small text-muted">Up to 10 conditions.</p>}
      </div>
    </fieldset>
  );
}

function ConditionRow({
  cond,
  index,
  sources,
  onChange,
  onRemove,
}: {
  cond: FormCondition;
  index: number;
  sources: readonly Source[];
  onChange(next: FormCondition): void;
  onRemove(): void;
}) {
  const id = useId();
  const source = sources.find((s) => s.prop.id === cond.questionPropertyId);
  const ops = source ? conditionOps(source.prop) : [];
  const problem = source ? conditionProblem(cond, source.prop) : null;
  const problemId = `${id}-problem`;
  return (
    <li className="flex flex-col gap-1">
      <div
        role="group"
        aria-label={`Condition ${index + 1}`}
        className="flex flex-wrap items-center gap-2"
      >
        <NativeSelect
          aria-label="Question"
          className="w-auto max-w-full"
          value={cond.questionPropertyId}
          onChange={(event) => {
            const next = sources.find((s) => s.prop.id === event.target.value);
            if (next) onChange({ ...newCondition(next.prop), id: cond.id });
          }}
        >
          {sources.map((s) => (
            <option key={s.prop.id} value={s.prop.id}>
              {questionLabel(s.question, s.prop)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Condition"
          className="w-auto"
          value={cond.op}
          onChange={(event) => {
            const op = ops.find((o) => o === event.target.value);
            if (!op) return;
            const next: FormCondition = { ...cond, op };
            if (NO_VALUE.has(op)) delete next.value;
            onChange(next);
          }}
        >
          {ops.map((op) => (
            <option key={op} value={op}>
              {conditionOpLabel(op)}
            </option>
          ))}
        </NativeSelect>
        {source && !NO_VALUE.has(cond.op) && (
          <ConditionValue
            cond={cond}
            prop={source.prop}
            invalid={problem !== null}
            describedBy={problem ? problemId : undefined}
            onChange={(value) => onChange({ ...cond, value })}
          />
        )}
        <IconButton label="Remove condition" variant="ghost" size="sm" onClick={onRemove}>
          <X aria-hidden />
        </IconButton>
      </div>
      {problem && (
        <p id={problemId} className="text-small text-danger">
          {problem}
        </p>
      )}
    </li>
  );
}

interface ValueProps {
  cond: FormCondition;
  prop: Property;
  invalid: boolean;
  describedBy: string | undefined;
  onChange(value: string | Id[]): void;
}

const idList = (v: FormCondition['value']): Id[] => (Array.isArray(v) ? v : []);
const text = (v: FormCondition['value']): string => (typeof v === 'string' ? v : '');

/** The value box for the earlier question's type: text, a number, options, a date, people or rows. */
function ConditionValue({ cond, prop, invalid, describedBy, onChange }: ValueProps) {
  const c = prop.config;
  switch (c.type) {
    case 'select':
    case 'multi_select': {
      const options = c.options.map((o): PickerOption => ({ id: o.id, label: o.name }));
      const ids = idList(cond.value);
      return (
        <ValuePicker
          invalid={invalid}
          describedBy={describedBy}
          selected={ids.flatMap((v) => options.filter((o) => o.id === v))}
          options={options}
          onChange={(next) => onChange(next.map((o) => o.id))}
        />
      );
    }
    case 'person':
    case 'relation':
      return (
        <SearchValue
          targetDatabaseId={c.type === 'relation' ? c.targetDatabaseId : null}
          ids={idList(cond.value)}
          invalid={invalid}
          describedBy={describedBy}
          onChange={onChange}
        />
      );
    case 'date':
      return (
        <Input
          type="date"
          aria-label="Value"
          className="w-auto"
          value={text(cond.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return (
        <CommitInput
          aria-label="Value"
          className="w-auto"
          inputMode={c.type === 'number' ? 'decimal' : undefined}
          value={text(cond.value)}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onCommit={(next) =>
            onChange(c.type === 'number' ? (normalizeDecimal(next) ?? next.trim()) : next)
          }
        />
      );
  }
}

function ValuePicker({
  invalid,
  describedBy,
  selected,
  options,
  onChange,
  onSearch,
  searching,
}: {
  invalid: boolean;
  describedBy: string | undefined;
  selected: readonly PickerOption[];
  options: readonly PickerOption[];
  onChange(next: PickerOption[]): void;
  onSearch?: (query: string) => void;
  searching?: boolean;
}) {
  const id = useId();
  return (
    <div className="min-w-48 flex-1">
      <VisuallyHidden id={`${id}-label`}>Value</VisuallyHidden>
      <Picker
        id={`${id}-box`}
        labelId={`${id}-label`}
        describedBy={describedBy}
        invalid={invalid}
        required={false}
        multiple
        selected={selected}
        options={options}
        onSearch={onSearch}
        searching={searching}
        onChange={onChange}
      />
    </div>
  );
}

/** People or rows, looked up as the person types. Names picked here show until the page reloads. */
function SearchValue({
  targetDatabaseId,
  ids,
  invalid,
  describedBy,
  onChange,
}: {
  targetDatabaseId: Id | null;
  ids: readonly Id[];
  invalid: boolean;
  describedBy: string | undefined;
  onChange(value: Id[]): void;
}) {
  const client = useFormsClient();
  const [query, setQuery] = useState('');
  const [names, setNames] = useState<Partial<Record<Id, string>>>({});
  const lookup = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      if (targetDatabaseId !== null) {
        const rows = await client.pickRows(targetDatabaseId, q);
        return rows.map((r) => ({ id: r.id, label: r.title || 'Untitled' }));
      }
      const people = await client.searchPeople(q);
      return people.map((p) => ({ id: p.id, label: p.name || p.email || 'Unknown' }));
    },
    [client, targetDatabaseId],
  );
  const { items, searching } = useSearch(lookup, query, true);
  return (
    <ValuePicker
      invalid={invalid}
      describedBy={describedBy}
      selected={ids.map((v) => ({ id: v, label: names[v] ?? 'Unknown' }))}
      options={items}
      onSearch={setQuery}
      searching={searching}
      onChange={(next) => {
        setNames((known) => ({
          ...known,
          ...Object.fromEntries(next.map((o) => [o.id, o.label])),
        }));
        onChange(next.map((o) => o.id));
      }}
    />
  );
}
