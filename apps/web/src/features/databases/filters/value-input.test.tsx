import type {
  EvalContext,
  FilterCondition,
  FilterOp,
  FilterValue,
  Property,
} from '@carehub/databases';
import { fireEvent, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { jobsProperties, PROPS, STATUS, testViewer, USERS } from '../fixtures';
import { renderWithDatabase } from '../test-utils';
import { withValue } from './filter-model';
import { ValueInput, type ValueInputProps } from './value-input';

const jobs = jobsProperties();
function job(id: string): Property {
  const found = jobs.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
}
const ctx: EvalContext = {
  properties: jobs,
  viewer: testViewer(),
  userName: (id) => (id === USERS.jordan.id ? USERS.jordan.name : undefined),
  rowTitle: () => undefined,
};

/** Keeps the rule like the panel does, and reports every value sent. */
function Harness({
  initial,
  property,
  onChange,
}: {
  initial: FilterCondition;
  property: Property;
  onChange: ValueInputProps['onChange'];
}) {
  const [rule, setRule] = useState(initial);
  return (
    <ValueInput
      rule={rule}
      property={property}
      ctx={ctx}
      people={[USERS.jordan]}
      onChange={(value) => {
        setRule(withValue(rule, value));
        onChange(value);
      }}
    />
  );
}

function renderValue(property: Property, op: FilterOp, value?: FilterValue) {
  const onChange = vi.fn<ValueInputProps['onChange']>();
  const rule: FilterCondition = { kind: 'condition', id: 'r1', propertyId: property.id, op };
  if (value !== undefined) rule.value = value;
  const utils = renderWithDatabase(
    <Harness initial={rule} property={property} onChange={onChange} />,
  );
  return { onChange, ...utils };
}
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe('filter values', () => {
  it('saves typed text on Enter, not on every letter', () => {
    const { onChange } = renderValue(job(PROPS.notes), 'contains');
    const input = screen.getByRole('textbox', { name: 'Value' });
    type(input, 'mornings');
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('mornings');
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('says "Enter a number." for a cost that isn\'t one, and saves one that is', () => {
    const { onChange } = renderValue(job(PROPS.cost), 'gte');
    const input = screen.getByRole('textbox', { name: 'Value' });
    type(input, 'lots');
    fireEvent.blur(input);
    expect(screen.getByText('Enter a number.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).not.toHaveBeenCalled();
    type(input, '$1,250.50');
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith('1250.5');
    expect(screen.queryByText('Enter a number.')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Value' })).toHaveValue('$1,250.50');
  });

  it("ticks options, keeping the property's order", () => {
    const { onChange } = renderValue(job(PROPS.status), 'is');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
    expect(onChange).toHaveBeenLastCalledWith([STATUS.done]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'In progress' }));
    expect(onChange).toHaveBeenLastCalledWith([STATUS.inProgress, STATUS.done]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
    expect(onChange).toHaveBeenLastCalledWith([STATUS.inProgress]);
  });

  it('ticks status groups for "Group is"', () => {
    const { onChange } = renderValue(job(PROPS.status), 'group_is');
    const list = screen.getByRole('list', { name: 'Value' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['To-do', 'In progress', 'Complete']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete' }));
    expect(onChange).toHaveBeenLastCalledWith(['complete']);
  });

  it('offers "Me" first, then the people', () => {
    const { onChange } = renderValue(job(PROPS.technician), 'contains_any');
    const [me, jordan] = within(screen.getByRole('list', { name: 'Value' })).getAllByRole(
      'checkbox',
    );
    expect(me).toBe(screen.getByRole('checkbox', { name: 'Me' }));
    expect(jordan).toBe(screen.getByRole('checkbox', { name: 'Jordan Park' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Me' }));
    expect(onChange).toHaveBeenLastCalledWith(['me']);
  });

  it('keeps a removed person who is already in the rule', () => {
    renderValue(job(PROPS.technician), 'contains_any', ['user-gone']);
    expect(screen.getByRole('checkbox', { name: 'Unknown person' })).toBeChecked();
  });

  it('finds related rows to pick', async () => {
    const related: Property = {
      id: 'prop-follow-up',
      name: 'Follow-up of',
      description: '',
      rowPage: 'always',
      config: {
        type: 'relation',
        targetDatabaseId: 'db-jobs',
        single: false,
        twoWayPropertyId: null,
      },
    };
    const { onChange, client } = renderValue(related, 'contains_any');
    type(screen.getByRole('searchbox', { name: 'Search rows' }), 'sink');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Fix kitchen sink leak' }));
    expect(onChange).toHaveBeenLastCalledWith(['row-sink']);
    expect(client.pickRows).toHaveBeenCalledWith('db-jobs', 'sink');
  });

  it('shows nothing for conditions without a value', () => {
    renderValue(job(PROPS.notes), 'is_empty');
    expect(screen.queryByRole('textbox')).toBeNull();
    renderValue(job(PROPS.paid), 'is_checked');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
