import type {
  EvalContext,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterValue,
} from '@carehub/databases';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { jobsProperties, PROPS, testViewer } from '../fixtures';
import { renderWithDatabase } from '../test-utils';
import { AdvancedFilter } from './advanced-filter';
import { newRule } from './filter-model';
import type { Editing } from './rule-fields';

const jobs = jobsProperties();
const ctx: EvalContext = { properties: jobs, viewer: testViewer(), userName: () => undefined };
const rule = (
  id: string,
  propertyId: string,
  op: FilterOp,
  value?: FilterValue,
): FilterCondition =>
  value === undefined
    ? { kind: 'condition', id, propertyId, op }
    : { kind: 'condition', id, propertyId, op, value };
const group = (
  id: string,
  children: FilterNode[],
  combinator: 'and' | 'or' = 'and',
): FilterGroup => ({ kind: 'group', id, combinator, children });

/** Keeps the filter like the panel does, and reports every save. */
function Harness({
  initial,
  onSave,
  onDelete,
}: {
  initial: FilterGroup;
  onSave: Editing['save'];
  onDelete(): void;
}) {
  const [root, setRoot] = useState(initial);
  const editing: Editing = {
    root,
    all: jobs,
    properties: jobs,
    ctx,
    people: [],
    save: (next) => {
      setRoot(next ?? group(initial.id, []));
      onSave(next);
    },
  };
  return <AdvancedFilter editing={editing} onDelete={onDelete} />;
}

function renderFilter(initial: FilterGroup = group('root', [])) {
  const onSave = vi.fn<Editing['save']>();
  const onDelete = vi.fn<() => void>();
  renderWithDatabase(<Harness initial={initial} onSave={onSave} onDelete={onDelete} />);
  return { onSave, onDelete };
}

/** The last filter saved, without the ids that newId makes up. */
function saved(onSave: ReturnType<typeof renderFilter>['onSave']): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([key]) => key !== 'id')
        .map(([key, inner]) => [key, strip(inner)]),
    );
  };
  return strip(onSave.mock.lastCall?.[0]);
}
const nameIs = { kind: 'condition', propertyId: PROPS.name, op: 'is' };
const optionTexts = (el: HTMLElement) =>
  within(el)
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('advanced filter', () => {
  it('builds nested All of and Any of groups, up to 3 layers', () => {
    const { onSave } = renderFilter();
    expect(screen.getByRole('heading', { name: 'Advanced filter' })).toBeInTheDocument();
    expect(screen.getByText('No filter rules yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add filter rule' }));
    expect(saved(onSave)).toEqual({ kind: 'group', combinator: 'and', children: [nameIs] });
    fireEvent.click(screen.getByRole('button', { name: 'Add filter group' }));
    const inner = screen.getByRole('group', { name: 'Filter group' });
    fireEvent.change(within(inner).getByRole('combobox', { name: 'Match' }), {
      target: { value: 'or' },
    });
    expect(saved(onSave)).toEqual({
      kind: 'group',
      combinator: 'and',
      children: [nameIs, { kind: 'group', combinator: 'or', children: [nameIs] }],
    });
    fireEvent.click(within(inner).getByRole('button', { name: 'Add filter group' }));
    const [, deepest] = screen.getAllByRole('group', { name: 'Filter group' });
    if (!deepest) throw new Error('No third layer');
    expect(within(deepest).getByText('Filters can have up to 3 layers.')).toBeInTheDocument();
    expect(within(deepest).queryByRole('button', { name: 'Add filter group' })).toBeNull();
    expect(onSave).toHaveBeenCalledTimes(4);
  });

  it('switches a group between All of and Any of', () => {
    const paid = rule('r1', PROPS.paid, 'is_checked');
    const notes = rule('r2', PROPS.notes, 'is_empty');
    const { onSave } = renderFilter(group('root', [paid, notes]));
    const match = screen.getByRole('combobox', { name: 'Match' });
    expect(optionTexts(match)).toEqual(['All of', 'Any of']);
    fireEvent.change(match, { target: { value: 'or' } });
    expect(onSave).toHaveBeenLastCalledWith(group('root', [paid, notes], 'or'));
  });

  it('duplicates a rule and deletes a group', () => {
    const paid = rule('r1', PROPS.paid, 'is_checked');
    const leak = group('g1', [rule('r2', PROPS.notes, 'contains', 'leak')], 'or');
    const { onSave } = renderFilter(group('root', [paid, leak]));
    const row = screen.getByRole('group', { name: 'Paid is ticked' });
    fireEvent.click(within(row).getByRole('button', { name: 'Duplicate rule' }));
    const copy = { ...paid, id: expect.any(String) };
    expect(onSave).toHaveBeenLastCalledWith(group('root', [paid, copy, leak]));
    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
    expect(onSave).toHaveBeenLastCalledWith(group('root', [paid, copy]));
  });

  it('duplicates a group with new ids', () => {
    const leak = group('g1', [rule('r2', PROPS.notes, 'contains', 'leak')], 'or');
    const { onSave } = renderFilter(group('root', [leak]));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate group' }));
    expect(onSave).toHaveBeenLastCalledWith(
      group('root', [
        leak,
        {
          ...leak,
          id: expect.any(String),
          children: [{ ...rule('r2', PROPS.notes, 'contains', 'leak'), id: expect.any(String) }],
        },
      ]),
    );
  });

  it('deletes a rule and the group it leaves empty, and offers "Delete filter"', () => {
    const paid = rule('r1', PROPS.paid, 'is_checked');
    const notes = rule('r2', PROPS.notes, 'is_empty');
    const { onSave, onDelete } = renderFilter(group('root', [paid, group('g1', [notes])]));
    const row = screen.getByRole('group', { name: 'Notes is empty' });
    fireEvent.click(within(row).getByRole('button', { name: 'Delete rule' }));
    expect(onSave).toHaveBeenLastCalledWith(group('root', [paid]));
    fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('stops at 50 rules', () => {
    const many = Array.from({ length: 50 }, (_, i) => rule(`r${i}`, PROPS.paid, 'is_checked'));
    renderFilter(group('root', many));
    expect(screen.getByText('Filters can have up to 50 conditions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add filter rule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add filter group' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Duplicate rule' })[0]).toBeDisabled();
  });

  const conditions: [string, string[]][] = [
    [
      PROPS.name,
      [
        'Is',
        'Is not',
        'Contains',
        'Does not contain',
        'Starts with',
        'Ends with',
        'Is empty',
        'Is not empty',
      ],
    ],
    [PROPS.status, ['Is', 'Is not', 'Group is', 'Is empty', 'Is not empty']],
    [PROPS.priority, ['Is', 'Is not', 'Is empty', 'Is not empty']],
    [
      PROPS.due,
      [
        'Is',
        'Is before',
        'Is after',
        'Is on or before',
        'Is on or after',
        'Is between',
        'Is within',
        'Is empty',
        'Is not empty',
      ],
    ],
    [PROPS.technician, ['Contains any of', 'Does not contain', 'Is empty', 'Is not empty']],
    [
      PROPS.cost,
      [
        'Equals',
        'Not equal',
        'Greater than',
        'Less than',
        'At least',
        'At most',
        'Is empty',
        'Is not empty',
      ],
    ],
    [PROPS.paid, ['Is ticked', 'Is not ticked']],
  ];
  it.each(conditions)('offers the conditions the package allows for %s', (propertyId, labels) => {
    const prop = jobs.find((p) => p.id === propertyId);
    if (!prop) throw new Error(`No property ${propertyId}`);
    renderFilter(group('root', [newRule(prop)]));
    expect(optionTexts(screen.getByRole('combobox', { name: 'Condition' }))).toEqual(labels);
  });

  it('keeps the value when the condition takes the same kind, and drops it otherwise', () => {
    const { onSave } = renderFilter(group('root', [rule('r1', PROPS.notes, 'contains', 'leak')]));
    const condition = () => screen.getByRole('combobox', { name: 'Condition' });
    fireEvent.change(condition(), { target: { value: 'starts_with' } });
    expect(onSave).toHaveBeenLastCalledWith(
      group('root', [rule('r1', PROPS.notes, 'starts_with', 'leak')]),
    );
    fireEvent.change(condition(), { target: { value: 'is_empty' } });
    expect(onSave).toHaveBeenLastCalledWith(group('root', [rule('r1', PROPS.notes, 'is_empty')]));
    expect(screen.queryByRole('textbox', { name: 'Value' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Property' }), {
      target: { value: PROPS.paid },
    });
    expect(onSave).toHaveBeenLastCalledWith(group('root', [rule('r1', PROPS.paid, 'is_checked')]));
  });
});
