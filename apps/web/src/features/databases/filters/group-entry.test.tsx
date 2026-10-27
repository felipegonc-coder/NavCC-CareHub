import { EMPTY_GROUP } from '@carehub/databases';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS, testViewer, VIEWS } from '../fixtures';
import { mockActions, renderWithDatabase } from '../test-utils';
import GroupEntry from './group-entry';

function show(data?: Parameters<typeof GroupEntry>[0]['data']) {
  const meta = jobsDatabase();
  const view = meta.views.find((v) => v.id === VIEWS.board);
  if (!view) throw new Error('No view');
  const actions = mockActions();
  renderWithDatabase(
    <GroupEntry
      panel="group"
      meta={meta}
      view={view}
      savedView={view}
      viewer={testViewer()}
      actions={actions}
      canEditViews
      close={vi.fn<() => void>()}
      data={data}
    />,
  );
  return actions;
}

describe('Group panel in the shell', () => {
  it('saves a change to the grouping through updateView', () => {
    const actions = show();
    const groupBy = screen.getByRole('combobox', { name: 'Group by' });
    fireEvent.change(groupBy, { target: { value: PROPS.paid } });
    expect(actions.updateView).toHaveBeenCalledWith({ grouping: { propertyId: PROPS.paid } });
  });

  it("names the board's columns from the view's answer", () => {
    const column = (key: string, label: string) => ({
      key,
      label,
      hidden: false,
      collapsedKey: `${PROPS.status}:value:${key}`,
      count: 0,
      totals: {},
      rows: [],
      nextCursor: null,
    });
    show({
      propertyIds: [PROPS.name, PROPS.status, PROPS.priority],
      rowTitles: {},
      groups: [column(EMPTY_GROUP, 'No value'), column('opt-later', 'Waiting on parts')],
      lanes: null,
    });
    const columns = within(screen.getByRole('list', { name: 'Groups' })).getAllByRole('listitem');
    expect(columns.map((li) => li.textContent)).toEqual(['No value', 'Waiting on parts']);
    const subGroupBy = screen.getByRole('combobox', { name: 'Sub-group by' });
    expect(
      within(subGroupBy)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['None', 'Priority']);
  });
});
