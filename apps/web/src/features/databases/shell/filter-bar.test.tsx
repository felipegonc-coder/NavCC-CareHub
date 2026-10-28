import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilterCondition, FilterGroup, View } from '@carehub/databases';
import {
  JOBS_ID,
  jobsDatabase,
  jobsViews,
  mockClient,
  PROPS,
  renderWithDatabase,
  STATUS,
  testViewer,
  USERS,
  VIEWS,
} from '../test-utils';
import { DatabaseView } from './database-view';
import { panelProbe } from './test-layout';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

vi.mock('../panels', async () => {
  const { probePanels } = await import('./test-layout');
  return { PANELS: probePanels() };
});

const viewer = testViewer();

const doneAndPaid: FilterGroup = {
  kind: 'group',
  id: 'root',
  combinator: 'and',
  children: [
    { kind: 'condition', id: 'c-status', propertyId: PROPS.status, op: 'is', value: [STATUS.done] },
    { kind: 'condition', id: 'c-paid', propertyId: PROPS.paid, op: 'is_checked' },
  ],
};

/** The Jobs database with the "All jobs" view changed. */
function withView(change: Partial<View>) {
  const client = mockClient();
  const views = jobsViews().map((v) => (v.id === VIEWS.table ? { ...v, ...change } : v));
  client.getDatabase.mockResolvedValue(jobsDatabase({ views }));
  return client;
}

async function shown(client = mockClient()) {
  renderWithDatabase(<DatabaseView databaseId={JOBS_ID} viewer={viewer} />, { client });
  await screen.findByTestId('probe-layout');
  return client;
}

beforeEach(() => {
  panelProbe.props = null;
  localStorage.clear();
});

describe('FilterBar', () => {
  it("doesn't show without sorts or rules", async () => {
    await shown();
    expect(screen.queryByRole('group', { name: 'Filter bar' })).toBeNull();
  });

  it('shows the sort, then a chip per rule that opens the Filter at its rule', async () => {
    await shown(
      withView({ filter: doneAndPaid, sorts: [{ propertyId: PROPS.due, direction: 'asc' }] }),
    );
    const bar = screen.getByRole('group', { name: 'Filter bar' });
    expect(
      within(bar)
        .getAllByRole('button')
        .map((chip) => chip.textContent),
    ).toEqual(['Due date', 'Status is Done', 'Paid is ticked']);

    const chip = within(bar).getByRole('button', { name: 'Status is Done' });
    fireEvent.click(chip);
    const panel = await screen.findByRole('dialog', { name: 'Filter' });
    expect(within(panel).getByText('Filter for All jobs')).toBeInTheDocument();
    expect(panelProbe.props).toMatchObject({ panel: 'filter', target: { ruleId: 'c-status' } });
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    fireEvent.keyDown(panel, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(chip).toHaveFocus());
  });

  it("names the people in the view's answer", async () => {
    const technician: FilterCondition = {
      kind: 'condition',
      id: 'c-technician',
      propertyId: PROPS.technician,
      op: 'contains_any',
      value: [USERS.jordan.id],
    };
    await shown(withView({ filter: { ...doneAndPaid, children: [technician] } }));
    expect(
      screen.getByRole('button', { name: 'Technician contains any of Jordan Park' }),
    ).toBeInTheDocument();
  });

  it('opens Sort under the sort chip', async () => {
    await shown(withView({ sorts: [{ propertyId: PROPS.due, direction: 'desc' }] }));
    fireEvent.click(screen.getByRole('button', { name: 'Sorted by Due date, descending' }));
    await screen.findByRole('dialog', { name: 'Sort' });
    expect(panelProbe.props?.panel).toBe('sort');
    expect(panelProbe.props?.target).toBeUndefined();
  });

  it('shows one "Advanced filter" chip for "Any of", which opens the groups', async () => {
    await shown(withView({ filter: { ...doneAndPaid, combinator: 'or' } }));
    const bar = screen.getByRole('group', { name: 'Filter bar' });
    expect(within(bar).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(bar).getByRole('button', { name: 'Advanced filter' }));
    await screen.findByRole('dialog', { name: 'Filter' });
    expect(panelProbe.props).toMatchObject({ panel: 'filter', target: { advanced: true } });
  });

  it("moves to the toolbar when the toolbar's button is pressed", async () => {
    await shown(withView({ filter: doneAndPaid }));
    const chip = screen.getByRole('button', { name: 'Paid is ticked' });
    fireEvent.click(chip);
    await screen.findByRole('dialog', { name: 'Filter' });

    const filter = screen.getByRole('button', { name: 'Filter' });
    fireEvent.click(filter);
    await waitFor(() => expect(filter).toHaveAttribute('aria-expanded', 'true'));
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(panelProbe.props?.target).toBeUndefined();
  });

  it('closes when its rule is removed', async () => {
    await shown(withView({ filter: doneAndPaid }));
    fireEvent.click(screen.getByRole('button', { name: 'Paid is ticked' }));
    await screen.findByRole('dialog', { name: 'Filter' });
    const props = panelProbe.props;
    if (!props) throw new Error('The panel has no props.');

    const statusOnly = { ...doneAndPaid, children: doneAndPaid.children.slice(0, 1) };
    await act(() => props.actions.updateView({ filter: statusOnly }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
