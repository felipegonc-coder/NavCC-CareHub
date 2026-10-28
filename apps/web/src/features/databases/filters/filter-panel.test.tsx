import type {
  DatabaseMeta,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOp,
  FilterValue,
} from '@carehub/databases';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS, STATUS, testViewer, USERS } from '../fixtures';
import { mockActions, renderWithDatabase, type MockActions } from '../test-utils';
import { FilterPanel } from './filter-panel';

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

function renderPanel(
  options: {
    meta?: DatabaseMeta;
    filter?: FilterGroup | null;
    ruleId?: string;
    advanced?: boolean;
  } = {},
) {
  const meta = options.meta ?? jobsDatabase();
  const [first] = meta.views;
  if (!first) throw new Error('No view');
  const actions = mockActions();
  const onClose = vi.fn<() => void>();
  renderWithDatabase(
    <FilterPanel
      meta={meta}
      view={{ ...first, filter: options.filter ?? null }}
      viewer={testViewer()}
      actions={actions}
      people={[USERS.jordan]}
      ruleId={options.ruleId}
      advanced={options.advanced}
      onClose={onClose}
    />,
  );
  return { actions, onClose };
}

/** The last patch sent, without the ids that newId makes up. */
function sent(actions: MockActions): unknown {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([key]) => key !== 'id')
        .map(([key, inner]) => [key, strip(inner)]),
    );
  };
  return strip(actions.updateView.mock.lastCall?.[0]);
}
const statusIs = (value?: string[]) => ({
  filter: {
    kind: 'group',
    combinator: 'and',
    children: [
      value
        ? { kind: 'condition', propertyId: PROPS.status, op: 'is', value }
        : { kind: 'condition', propertyId: PROPS.status, op: 'is' },
    ],
  },
});
const propertyButtons = () =>
  within(screen.getByRole('list', { name: 'Filter by' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('Filter panel', () => {
  it('lists the properties, adds a rule for the one picked, then saves its value', () => {
    const { actions } = renderPanel();
    expect(propertyButtons()).toEqual([
      'Name',
      'Status',
      'Priority',
      'Due date',
      'Technician',
      'Cost',
      'Paid',
      'Notes',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(sent(actions)).toEqual(statusIs());
    expect(screen.getByRole('combobox', { name: 'Property' })).toHaveValue(PROPS.status);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Done' }));
    expect(sent(actions)).toEqual(statusIs([STATUS.done]));
    expect(actions.updateView).toHaveBeenCalledTimes(2);
  });

  it('adds a rule next to the chips already there', () => {
    const paid = rule('r1', PROPS.paid, 'is_checked');
    const { actions } = renderPanel({ filter: group('root', [paid]) });
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      filter: group('root', [
        paid,
        { kind: 'condition', id: expect.any(String), propertyId: PROPS.notes, op: 'is' },
      ]),
    });
  });

  it('searches the properties by name', () => {
    renderPanel();
    const search = screen.getByRole('searchbox', { name: 'Filter by' });
    fireEvent.change(search, { target: { value: 'due' } });
    expect(propertyButtons()).toEqual(['Due date']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('only offers the properties the viewer can see', () => {
    const meta = jobsDatabase();
    const [view] = meta.views;
    if (!view) throw new Error('No view');
    renderWithDatabase(
      <FilterPanel
        meta={meta}
        view={view}
        viewer={testViewer()}
        actions={mockActions()}
        propertyIds={[PROPS.name, PROPS.paid]}
      />,
    );
    expect(propertyButtons()).toEqual(['Name', 'Paid']);
  });

  it('"Delete filter" removes the chip\'s rule and closes', () => {
    const paid = rule('r1', PROPS.paid, 'is_checked');
    const notes = rule('r2', PROPS.notes, 'is_empty');
    const { actions, onClose } = renderPanel({
      filter: group('root', [paid, notes]),
      ruleId: 'r1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));
    expect(actions.updateView).toHaveBeenCalledWith({ filter: group('root', [notes]) });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves no filter once the last rule is deleted', () => {
    const { actions } = renderPanel({
      filter: group('root', [rule('r1', PROPS.paid, 'is_checked')]),
      ruleId: 'r1',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));
    expect(actions.updateView).toHaveBeenCalledWith({ filter: null });
  });

  it('"Turn into advanced filter" moves the rules into a group', () => {
    const paid = rule('r1', PROPS.paid, 'is_checked');
    const { actions } = renderPanel({ filter: group('root', [paid]), ruleId: 'r1' });
    fireEvent.click(screen.getByRole('button', { name: 'Turn into advanced filter' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      filter: {
        kind: 'group',
        id: 'root',
        combinator: 'and',
        children: [{ kind: 'group', id: expect.any(String), combinator: 'and', children: [paid] }],
      },
    });
    expect(screen.getByRole('heading', { name: 'Advanced filter' })).toBeInTheDocument();
  });

  it('"Add advanced filter" starts one with a rule on the first property', () => {
    const { actions } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Add advanced filter' }));
    expect(sent(actions)).toEqual({
      filter: {
        kind: 'group',
        combinator: 'and',
        children: [
          {
            kind: 'group',
            combinator: 'and',
            children: [{ kind: 'condition', propertyId: PROPS.name, op: 'is' }],
          },
        ],
      },
    });
    expect(screen.getByRole('group', { name: 'Name is' })).toBeInTheDocument();
  });

  it('opens on the advanced filter when the view has one, and deletes it all', () => {
    const { actions, onClose } = renderPanel({
      filter: group('root', [group('g1', [rule('r1', PROPS.paid, 'is_checked')])]),
    });
    expect(screen.getByRole('heading', { name: 'Advanced filter' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Paid is ticked' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));
    expect(actions.updateView).toHaveBeenCalledWith({ filter: null });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('says so when there is nothing to filter by', () => {
    const meta = jobsDatabase();
    const [view] = meta.views;
    if (!view) throw new Error('No view');
    renderWithDatabase(
      <FilterPanel
        meta={meta}
        view={view}
        viewer={testViewer()}
        actions={mockActions()}
        propertyIds={[]}
      />,
    );
    expect(screen.getByText('No properties to filter by.')).toBeInTheDocument();
  });
});
