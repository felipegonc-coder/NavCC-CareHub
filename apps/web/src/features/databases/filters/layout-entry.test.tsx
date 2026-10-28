import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, testViewer } from '../fixtures';
import { mockActions } from '../test-utils';
import LayoutEntry from './layout-entry';

describe('Layout panel in the shell', () => {
  it('saves a setting for everyone through updateView', () => {
    const meta = jobsDatabase();
    const [view] = meta.views;
    if (!view) throw new Error('No view');
    const actions = mockActions();
    render(
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
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Open rows in' }), {
      target: { value: 'full_page' },
    });
    expect(actions.updateView).toHaveBeenCalledWith({ openPagesIn: 'full_page' });
  });
});
