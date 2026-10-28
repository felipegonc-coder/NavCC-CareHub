import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS, testViewer, USERS } from '../fixtures';
import { mockActions, mockClient, renderWithDatabase } from '../test-utils';
import LayoutEntry from './layout-entry';

function show() {
  const meta = jobsDatabase();
  const [view] = meta.views;
  if (!view) throw new Error('No view');
  const actions = mockActions();
  const client = mockClient();
  renderWithDatabase(
    <LayoutEntry
      panel="layout"
      meta={meta}
      view={view}
      savedView={view}
      viewer={testViewer()}
      actions={actions}
      canEditViews
      close={vi.fn<() => void>()}
    />,
    { client },
  );
  return { actions, client };
}

describe('Layout panel in the shell', () => {
  it('saves a setting for everyone through updateView', () => {
    const { actions } = show();
    fireEvent.change(screen.getByRole('combobox', { name: 'Open rows in' }), {
      target: { value: 'full_page' },
    });
    expect(actions.updateView).toHaveBeenCalledWith({ openPagesIn: 'full_page' });
  });

  it("offers the workspace's people in a color rule's Person condition", async () => {
    const { actions, client } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Conditional color' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add color rule' }));
    const when = screen.getByRole('group', { name: 'When' });
    fireEvent.change(within(when).getByRole('combobox', { name: 'Property' }), {
      target: { value: PROPS.technician },
    });
    const jordan = await within(when).findByRole('checkbox', { name: USERS.jordan.name });
    expect(client.listMembers).toHaveBeenCalledWith('');
    fireEvent.click(jordan);
    expect(actions.updateView).toHaveBeenLastCalledWith({
      colorRules: [
        expect.objectContaining({
          filter: expect.objectContaining({
            children: [
              expect.objectContaining({
                propertyId: PROPS.technician,
                op: 'contains_any',
                value: [USERS.jordan.id],
              }),
            ],
          }),
        }),
      ],
    });
  });
});
