import type { ColorRule, EvalContext, FilterGroup, View } from '@carehub/databases';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS, STATUS, testViewer, VIEWS } from '../fixtures';
import { mockActions, renderWithDatabase } from '../test-utils';
import { ColorRules } from './color-rules';

const statusIs = (id: string, ...value: string[]): FilterGroup => ({
  kind: 'group',
  id: `${id}-group`,
  combinator: 'and',
  children: [{ kind: 'condition', id, propertyId: PROPS.status, op: 'is', value }],
});
const doneRow: ColorRule = {
  id: 'rule-done',
  filter: statusIs('c-done', STATUS.done),
  target: { kind: 'row' },
  color: 'green',
};
const unpaidCost: ColorRule = {
  id: 'rule-unpaid',
  filter: {
    kind: 'group',
    id: 'g-unpaid',
    combinator: 'and',
    children: [{ kind: 'condition', id: 'c-unpaid', propertyId: PROPS.paid, op: 'is_not_checked' }],
  },
  target: { kind: 'property', propertyId: PROPS.cost },
  color: 'red',
};

function show(colorRules: ColorRule[], canEdit = true) {
  const meta = jobsDatabase();
  const table = meta.views.find((v) => v.id === VIEWS.table);
  if (!table) throw new Error('No view');
  const view: View = { ...table, colorRules };
  const ctx: EvalContext = {
    properties: meta.properties,
    viewer: testViewer(),
    userName: () => undefined,
  };
  const actions = mockActions();
  const onBack = vi.fn<() => void>();
  renderWithDatabase(
    <ColorRules
      meta={meta}
      view={view}
      actions={actions}
      canEdit={canEdit}
      people={[]}
      ctx={ctx}
      onBack={onBack}
    />,
  );
  return { actions, onBack };
}

const button = (name: string) => screen.getByRole('button', { name });
const lines = () =>
  within(screen.getByRole('list', { name: 'Conditional color' }))
    .getAllByRole('listitem')
    .map((item) => item.textContent);

describe('Conditional color', () => {
  it('lists the rules with their color and what they color', () => {
    const { onBack } = show([doneRow, unpaidCost]);
    expect(button('Back')).toHaveFocus();
    expect(
      screen.getByText(
        'Color rows, or one property’s cells, when a condition matches. The first rule that matches wins.',
      ),
    ).toBeInTheDocument();
    expect(lines()).toEqual(['GreenWhole row · Status is Done', 'RedCost · Paid is not ticked']);
    for (const name of ['Move rule 2', 'Edit rule 2', 'Duplicate rule 2', 'Delete rule 2']) {
      expect(button(name)).toBeEnabled();
    }
    fireEvent.click(button('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('adds a rule that colors the whole row yellow and opens it', () => {
    const { actions } = show([]);
    expect(screen.getByText('No color rules yet.')).toBeInTheDocument();
    fireEvent.click(button('Add color rule'));
    expect(actions.updateView).toHaveBeenCalledWith({
      colorRules: [
        {
          id: expect.any(String),
          filter: {
            kind: 'group',
            id: expect.any(String),
            combinator: 'and',
            children: [
              { kind: 'condition', id: expect.any(String), propertyId: PROPS.name, op: 'is' },
            ],
          },
          target: { kind: 'row' },
          color: 'yellow',
        },
      ],
    });
    expect(screen.getByRole('heading', { name: 'Edit rule 1' })).toBeInTheDocument();
    expect(button('Back')).toHaveFocus();
  });

  it('changes what a rule colors, its color and its condition, one patch each', () => {
    const { actions } = show([doneRow]);
    fireEvent.click(button('Edit rule 1'));
    const target = screen.getByRole('combobox', { name: 'Apply to' });
    expect(within(target).getAllByRole('option')[0]).toHaveTextContent('Whole row');
    fireEvent.change(target, { target: { value: PROPS.cost } });
    const onCost: ColorRule = { ...doneRow, target: { kind: 'property', propertyId: PROPS.cost } };
    expect(actions.updateView).toHaveBeenLastCalledWith({ colorRules: [onCost] });
    const colors = screen.getByRole('group', { name: 'Color' });
    expect(within(colors).getAllByRole('radio')).toHaveLength(9);
    expect(within(colors).getByRole('radio', { name: 'Green' })).toBeChecked();
    fireEvent.click(within(colors).getByRole('radio', { name: 'Red' }));
    const red: ColorRule = { ...onCost, color: 'red' };
    expect(actions.updateView).toHaveBeenLastCalledWith({ colorRules: [red] });
    const when = screen.getByRole('group', { name: 'When' });
    fireEvent.click(within(when).getByRole('checkbox', { name: 'In progress' }));
    expect(actions.updateView).toHaveBeenLastCalledWith({
      colorRules: [{ ...red, filter: statusIs('c-done', STATUS.inProgress, STATUS.done) }],
    });
    expect(actions.updateView).toHaveBeenCalledTimes(3);
    fireEvent.click(button('Back'));
    expect(lines()).toEqual(['RedCost · Status is In progress, Done']);
    expect(button('Edit rule 1')).toHaveFocus();
  });

  it('duplicates and deletes rules, and moves them with the arrow keys', () => {
    const { actions } = show([doneRow, unpaidCost]);
    fireEvent.click(button('Duplicate rule 1'));
    const [condition] = doneRow.filter.children;
    const copy = {
      ...doneRow,
      id: expect.any(String),
      filter: {
        ...doneRow.filter,
        id: expect.any(String),
        children: [{ ...condition, id: expect.any(String) }],
      },
    };
    expect(actions.updateView).toHaveBeenLastCalledWith({
      colorRules: [doneRow, copy, unpaidCost],
    });
    fireEvent.click(button('Delete rule 1'));
    expect(actions.updateView).toHaveBeenLastCalledWith({ colorRules: [copy, unpaidCost] });
    expect(button('Edit rule 1')).toHaveFocus();
    fireEvent.keyDown(button('Move rule 2'), { key: 'ArrowUp' });
    expect(actions.updateView).toHaveBeenLastCalledWith({ colorRules: [unpaidCost, copy] });
    expect(screen.getByText('Moved rule 2 to 1 of 2.')).toBeInTheDocument();
    expect(button('Move rule 1')).toHaveFocus();
    expect(lines()).toEqual(['RedCost · Paid is not ticked', 'GreenWhole row · Status is Done']);
  });

  it('stops at 10 rules', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...doneRow, id: `rule-${i}` }));
    show(many);
    expect(screen.getByText('Up to 10 rules.')).toBeInTheDocument();
    expect(button('Add color rule')).toBeDisabled();
    expect(button('Duplicate rule 1')).toBeDisabled();
  });

  it("doesn't send rules the package refuses, and says why", () => {
    const gone: ColorRule = { ...doneRow, target: { kind: 'property', propertyId: 'prop-gone' } };
    const { actions } = show([gone, unpaidCost]);
    expect(lines()[0]).toBe('GreenThis property was deleted. · Status is Done');
    fireEvent.click(button('Delete rule 2'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A color rule uses a property that was deleted.',
    );
    expect(actions.updateView).not.toHaveBeenCalled();
    fireEvent.click(button('Edit rule 1'));
    const target = screen.getByRole('combobox', { name: 'Apply to' });
    expect(target).toHaveDisplayValue('This property was deleted.');
    fireEvent.change(target, { target: { value: '' } });
    expect(actions.updateView).toHaveBeenCalledWith({ colorRules: [doneRow] });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('puts the rules back when the server refuses a change', async () => {
    const { actions } = show([doneRow]);
    actions.updateView.mockRejectedValueOnce(new Error('Offline'));
    fireEvent.click(button('Delete rule 1'));
    expect(actions.updateView).toHaveBeenCalledWith({ colorRules: [] });
    expect(await screen.findByText('Whole row · Status is Done')).toBeInTheDocument();
  });

  it("only lists the rules for people who can't edit the view", () => {
    show([doneRow], false);
    expect(
      screen.getByText('Only people who can edit this view change its color rules.'),
    ).toBeInTheDocument();
    expect(lines()).toEqual(['GreenWhole row · Status is Done']);
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Back']);
  });
});
