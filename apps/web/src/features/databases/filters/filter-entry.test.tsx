import type { FilterCondition, FilterGroup, View } from '@carehub/databases';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PanelProps } from '../contract';
import { jobsDatabase, PROPS, testViewer, USERS } from '../fixtures';
import { mockActions, mockClient, renderWithDatabase } from '../test-utils';
import FilterEntry from './filter-entry';
import type { PanelExtras } from './types';

const technician: FilterCondition = {
  kind: 'condition',
  id: 'r1',
  propertyId: PROPS.technician,
  op: 'contains_any',
};
const byTechnician: FilterGroup = {
  kind: 'group',
  id: 'root',
  combinator: 'and',
  children: [technician],
};

/** The Filter panel as the shell draws it, with the props of PanelProps. */
function show(
  filter: FilterGroup | null,
  extras: PanelExtras & Pick<PanelProps, 'propertyIds' | 'rowTitles'> = {},
) {
  const meta = jobsDatabase();
  const [first] = meta.views;
  if (!first) throw new Error('No view');
  const view: View = { ...first, filter };
  const actions = mockActions();
  const close = vi.fn<() => void>();
  const client = mockClient();
  renderWithDatabase(
    <FilterEntry
      panel="filter"
      meta={meta}
      view={view}
      savedView={view}
      viewer={testViewer()}
      actions={actions}
      canEditViews
      close={close}
      {...extras}
    />,
    { client },
  );
  return { actions, close, client };
}

const propertyButtons = () =>
  within(screen.getByRole('list', { name: 'Filter by' }))
    .getAllByRole('button')
    .map((b) => b.textContent);

describe('Filter panel in the shell', () => {
  it('starts on the property list and adds a rule for the property picked', () => {
    const { actions } = show(null);
    fireEvent.click(screen.getByRole('button', { name: 'Status' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      filter: {
        kind: 'group',
        id: expect.any(String),
        combinator: 'and',
        children: [
          { kind: 'condition', id: expect.any(String), propertyId: PROPS.status, op: 'is' },
        ],
      },
    });
  });

  it("offers the workspace's people after Me in Person rules", async () => {
    const { actions, client } = show(byTechnician, { target: { ruleId: 'r1' } });
    const jordan = await screen.findByRole('checkbox', { name: USERS.jordan.name });
    expect(client.listMembers).toHaveBeenCalledWith('');
    expect(within(screen.getByRole('list', { name: 'Value' })).getAllByRole('checkbox')).toEqual([
      screen.getByRole('checkbox', { name: 'Me' }),
      screen.getByRole('checkbox', { name: USERS.avery.name }),
      jordan,
    ]);
    fireEvent.click(jordan);
    expect(actions.updateView).toHaveBeenCalledWith({
      filter: { ...byTechnician, children: [{ ...technician, value: [USERS.jordan.id] }] },
    });
  });

  it("closes once the chip's rule is deleted", () => {
    const { actions, close } = show(byTechnician, { target: { ruleId: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete filter' }));
    expect(actions.updateView).toHaveBeenCalledWith({ filter: null });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('opens on the advanced filter from its chip', () => {
    show(null, { target: { advanced: true } });
    expect(screen.getByRole('heading', { name: 'Advanced filter' })).toBeInTheDocument();
  });

  it('only offers the properties the viewer can see, when the shell says which', () => {
    show(null, { propertyIds: [PROPS.name, PROPS.paid] });
    expect(propertyButtons()).toEqual(['Name', 'Paid']);
  });
});
