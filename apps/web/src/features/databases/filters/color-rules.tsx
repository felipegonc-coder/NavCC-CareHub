/**
 * Conditional color (Databases spec 3.14), a page of the Layout panel: up to 10 rules, each "when
 * a filter condition matches, color the row, or one property's cell, in one of the 10 option
 * colors". The first matching row rule wins; a cell rule wins over the row color in its cell.
 * Every change is one updateView({ colorRules }) with the whole list. Rules the package refuses
 * (validateColorRules) aren't sent, and the page says why.
 */
import type {
  ColorRule,
  DatabaseMeta,
  EvalContext,
  Id,
  OptionColor,
  View,
} from '@carehub/databases';
import { RULE_COLORS } from '@carehub/databases/color';
import { Button, cn, colorClasses, IconButton } from '@carehub/ui';
import { ArrowLeft, Copy, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PersonChoice } from '../cells';
import { NativeSelect } from '../cells/controls';
import { OPTION_COLOR_LABELS } from '../cells/messages';
import type { ViewActions } from '../contract';
import { GroupEditor } from './advanced-filter';
import { filterableProperties, newGroup } from './filter-model';
import {
  canAddColorRule,
  colorRulesProblem,
  colorRuleSummary,
  colorTargets,
  newColorRule,
  withColorRule,
  withColorRuleCopied,
  withColorRuleMoved,
  withoutColorRule,
} from './layout-model';
import { COLOR_TEXT, LAYOUT_TEXT } from './layout-text';
import { useReorder } from './reorder';
import type { Editing } from './rule-fields';

export interface ColorRulesProps {
  meta: DatabaseMeta;
  view: View;
  actions: Pick<ViewActions, 'updateView'>;
  /** Changes are saved for everyone; otherwise the rules are only listed. */
  canEdit: boolean;
  /** The properties the viewer can see (the query answer's propertyIds); all when absent. */
  propertyIds?: readonly Id[] | undefined;
  people: readonly PersonChoice[];
  /** Names people and related rows in the rules' summaries. */
  ctx: EvalContext;
  onBack(): void;
}

const NO_RULES: readonly ColorRule[] = [];

export function ColorRules(props: ColorRulesProps) {
  const { meta, view, actions, propertyIds } = props;
  // The page keeps its own copy so quick changes build on each other; a newer saved list (or a
  // rollback after the server refused) replaces it.
  const [saved, setSaved] = useState(view.colorRules);
  const [rules, setRules] = useState(view.colorRules ?? NO_RULES);
  if (view.colorRules !== saved) {
    setSaved(view.colorRules);
    setRules(view.colorRules ?? NO_RULES);
  }
  const [open, setOpen] = useState<Id | null>(null);
  const [closed, setClosed] = useState<Id | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const filterable = useMemo(
    () => filterableProperties(meta.properties, propertyIds),
    [meta.properties, propertyIds],
  );

  const save = (next: ColorRule[]) => {
    setRules(next);
    const why = colorRulesProblem(next, meta.properties);
    setProblem(why);
    if (why) return;
    const before = view.colorRules ?? NO_RULES;
    actions.updateView({ colorRules: next }).catch(() => setRules(before));
  };

  const at = rules.findIndex((r) => r.id === open);
  const rule = rules[at];
  if (rule) {
    return (
      <RuleEditor
        {...props}
        rule={rule}
        position={at + 1}
        filterable={filterable}
        problem={problem}
        onChange={(change) => save(withColorRule(rules, rule.id, change))}
        onBack={() => {
          setOpen(null);
          setClosed(rule.id);
        }}
      />
    );
  }
  return (
    <RuleList
      {...props}
      rules={rules}
      filterable={filterable}
      problem={problem}
      focusRule={closed}
      save={save}
      onEdit={setOpen}
    />
  );
}

// ---------------------------------------------------------------- the list of rules

function RuleList({
  rules,
  canEdit,
  ctx,
  filterable,
  problem,
  focusRule,
  save,
  onEdit,
  onBack,
}: ColorRulesProps & {
  rules: readonly ColorRule[];
  filterable: ReturnType<typeof filterableProperties>;
  problem: string | null;
  /** Back from a rule: focus goes to its Edit button. */
  focusRule: Id | null;
  save(next: ColorRule[]): void;
  onEdit(id: Id): void;
}) {
  const ids = useId();
  const back = useRef<HTMLButtonElement | null>(null);
  const add = useRef<HTMLButtonElement | null>(null);
  const edits = useRef(new Map<Id, HTMLButtonElement>());
  const focusFirst = useRef(focusRule);
  useEffect(() => {
    const id = focusFirst.current;
    (id ? edits.current.get(id) : back.current)?.focus();
  }, []);
  // After a delete, focus goes to the next rule's Edit button (or the one before), else to Add.
  const [refocus, setRefocus] = useState<{ to: Id | null } | null>(null);
  useEffect(() => {
    if (!refocus) return;
    (refocus.to ? edits.current.get(refocus.to) : add.current)?.focus();
    setRefocus(null);
  }, [refocus]);
  const [said, setSaid] = useState('');
  const reorder = useReorder(rules.length, (from, to) => {
    save(withColorRuleMoved(rules, from, to));
    setSaid(COLOR_TEXT.moved(from + 1, to + 1, rules.length));
  });
  const { drag } = reorder;
  const room = canAddColorRule(rules);
  return (
    <div className="flex flex-col gap-3">
      <Button ref={back} variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {COLOR_TEXT.back}
      </Button>
      <h2 id={`${ids}-title`} className="text-small font-semibold text-fg">
        {COLOR_TEXT.title}
      </h2>
      <p className="text-label text-muted">{COLOR_TEXT.intro}</p>
      {!canEdit && <p className="text-label text-muted">{COLOR_TEXT.readOnly}</p>}
      {rules.length === 0 ? (
        <p className="text-small text-muted">{COLOR_TEXT.none}</p>
      ) : (
        <ul aria-labelledby={`${ids}-title`} className="flex flex-col gap-1">
          {rules.map((rule, index) => {
            const position = index + 1;
            return (
              <li
                key={rule.id}
                ref={reorder.rowRef(index)}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded px-1 py-0.5',
                  drag?.from === index && 'bg-fill',
                  drag && drag.to === index && drag.from !== index && 'ring-2 ring-ring',
                )}
              >
                {canEdit && (
                  <IconButton
                    {...reorder.handle(index)}
                    label={COLOR_TEXT.move(position)}
                    size="sm"
                    className="cursor-grab touch-none"
                  >
                    <GripVertical aria-hidden className="size-4" />
                  </IconButton>
                )}
                <ColorChip color={rule.color} />
                <span className="min-w-0 flex-1 truncate text-small text-fg">
                  {colorRuleSummary(rule, ctx)}
                </span>
                {canEdit && (
                  <>
                    <IconButton
                      ref={(el) => {
                        if (el) edits.current.set(rule.id, el);
                        else edits.current.delete(rule.id);
                      }}
                      label={COLOR_TEXT.edit(position)}
                      size="sm"
                      onClick={() => onEdit(rule.id)}
                    >
                      <Pencil aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton
                      label={COLOR_TEXT.duplicate(position)}
                      size="sm"
                      disabled={!room}
                      onClick={() => save(withColorRuleCopied(rules, rule.id))}
                    >
                      <Copy aria-hidden className="size-4" />
                    </IconButton>
                    <IconButton
                      label={COLOR_TEXT.remove(position)}
                      size="sm"
                      onClick={() => {
                        const near = rules[index + 1] ?? rules[index - 1];
                        save(withoutColorRule(rules, rule.id));
                        setRefocus({ to: near?.id ?? null });
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </IconButton>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <Button
          ref={add}
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={!room || filterable.length === 0}
          onClick={() => {
            const rule = newColorRule(filterable);
            save([...rules, rule]);
            onEdit(rule.id);
          }}
        >
          <Plus aria-hidden className="size-4" />
          {COLOR_TEXT.add}
        </Button>
      )}
      {canEdit && !room && <p className="text-label text-muted">{COLOR_TEXT.tooMany}</p>}
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {said}
      </p>
    </div>
  );
}

function ColorChip({ color }: { color: OptionColor }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 text-label',
        colorClasses[color].bg,
        colorClasses[color].text,
      )}
    >
      {OPTION_COLOR_LABELS[color]}
    </span>
  );
}

// ---------------------------------------------------------------- one rule

function RuleEditor({
  meta,
  propertyIds,
  people,
  ctx,
  rule,
  position,
  filterable,
  problem,
  onChange,
  onBack,
}: ColorRulesProps & {
  rule: ColorRule;
  position: number;
  filterable: ReturnType<typeof filterableProperties>;
  problem: string | null;
  onChange(change: Partial<Omit<ColorRule, 'id'>>): void;
}) {
  const id = useId();
  const back = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    back.current?.focus();
  }, []);
  const targets = colorTargets(meta.properties, propertyIds);
  const { target } = rule;
  // A target the list doesn't offer (deleted, or one the viewer can't see) still shows as picked.
  const missing =
    target.kind === 'property' && !targets.some((p) => p.id === target.propertyId)
      ? target.propertyId
      : null;
  const editing: Editing = {
    root: rule.filter,
    all: meta.properties,
    properties: filterable,
    ctx,
    people,
    save: (next) => onChange({ filter: next ?? newGroup() }),
  };
  return (
    <div className="flex flex-col gap-3">
      <Button ref={back} variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ArrowLeft aria-hidden className="size-4" />
        {COLOR_TEXT.back}
      </Button>
      <h2 className="text-small font-semibold text-fg">{COLOR_TEXT.edit(position)}</h2>
      <GroupEditor group={rule.filter} depth={1} editing={editing} label={COLOR_TEXT.when} />
      <div className="flex items-center gap-2">
        <span id={`${id}-target`} className="w-20 shrink-0 text-small text-fg">
          {COLOR_TEXT.target}
        </span>
        <NativeSelect
          aria-labelledby={`${id}-target`}
          className="min-w-0 flex-1"
          value={target.kind === 'row' ? '' : target.propertyId}
          onChange={(e) => {
            const propertyId = e.target.value;
            onChange({ target: propertyId ? { kind: 'property', propertyId } : { kind: 'row' } });
          }}
        >
          <option value="">{COLOR_TEXT.row}</option>
          {missing !== null && (
            <option value={missing}>
              {meta.properties.find((p) => p.id === missing)?.name ?? LAYOUT_TEXT.deletedProperty}
            </option>
          )}
          {targets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-1">
        <legend className="mb-1 text-small text-fg">{COLOR_TEXT.color}</legend>
        <div className="flex flex-wrap gap-1">
          {RULE_COLORS.map((color) => (
            <label
              key={color}
              className={cn(
                'flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-label',
                colorClasses[color].bg,
                colorClasses[color].text,
              )}
            >
              <input
                type="radio"
                name={`${id}-color`}
                value={color}
                checked={rule.color === color}
                onChange={() => onChange({ color })}
              />
              {OPTION_COLOR_LABELS[color]}
            </label>
          ))}
        </div>
      </fieldset>
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
