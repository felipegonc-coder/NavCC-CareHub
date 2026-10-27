/**
 * One filter rule's property, condition and value, as the chip's panel and the advanced filter
 * show it. The conditions a property offers come from the package (filterOpsFor).
 */
import type {
  EvalContext,
  FilterCondition,
  FilterGroup,
  FilterOp,
  Property,
} from '@carehub/databases';
import { filterOpLabel, filterOpsFor } from '@carehub/databases/filter';
import type { PersonChoice } from '../cells';
import { NativeSelect } from '../cells/controls';
import { replaceRule, withOp, withProperty, withValue } from './filter-model';
import { FILTER_TEXT } from './messages';
import { ValueInput } from './value-input';

/** What the rule editors need besides the rule. */
export interface Editing {
  /** The whole filter. */
  root: FilterGroup;
  /** Every property, to name the one a rule uses. */
  all: readonly Property[];
  /** The ones a rule can pick (filterableProperties). */
  properties: readonly Property[];
  ctx: EvalContext;
  people: readonly PersonChoice[];
  /** Sends the changed filter (null: no filter). */
  save(next: FilterGroup | null): void;
}

/** Property, condition and value of one rule. */
export function RuleFields({ rule, editing }: { rule: FilterCondition; editing: Editing }) {
  const { root, all, properties, ctx, people, save } = editing;
  const prop = all.find((p) => p.id === rule.propertyId);
  const ops = prop ? filterOpsFor(prop) : [];
  const change = (next: FilterCondition) => save(replaceRule(root, next));
  const listed = properties.some((p) => p.id === rule.propertyId);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={FILTER_TEXT.property}
          className="w-auto min-w-0 flex-1"
          value={rule.propertyId}
          onChange={(e) => {
            const to = properties.find((p) => p.id === e.target.value);
            if (to) change(withProperty(rule, prop, to));
          }}
        >
          {!listed && (
            <option value={rule.propertyId} disabled>
              {prop?.name ?? FILTER_TEXT.deletedProperty}
            </option>
          )}
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
        {prop && (
          <NativeSelect
            aria-label={FILTER_TEXT.condition}
            className="w-auto min-w-0 flex-1"
            value={rule.op}
            onChange={(e) => {
              const op = ops.find((o): o is FilterOp => o === e.target.value);
              if (op) change(withOp(rule, prop, op));
            }}
          >
            {ops.map((op) => (
              <option key={op} value={op}>
                {filterOpLabel(op)}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>
      {prop ? (
        <ValueInput
          key={`${rule.propertyId}:${rule.op}`}
          rule={rule}
          property={prop}
          ctx={ctx}
          people={people}
          onChange={(value) => change(withValue(rule, value))}
        />
      ) : (
        <p className="text-small text-muted">{FILTER_TEXT.deletedProperty}</p>
      )}
    </div>
  );
}
