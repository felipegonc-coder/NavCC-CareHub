import type { Sort, View } from '@carehub/databases';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS, testViewer } from '../fixtures';
import { mockActions } from '../test-utils';
import SortEntry from './sort-entry';

describe('Sort panel in the shell', () => {
  it('adds a sort and saves it through updateView', () => {
    const meta = jobsDatabase();
    const [first] = meta.views;
    if (!first) throw new Error('No view');
    const due: Sort = { propertyId: PROPS.due, direction: 'desc' };
    const view: View = { ...first, sorts: [due] };
    const actions = mockActions();
    render(
      <SortEntry
        panel="sort"
        meta={meta}
        view={view}
        savedView={view}
        viewer={testViewer()}
        actions={actions}
        canEditViews={false}
        close={vi.fn<() => void>()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add sort' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      sorts: [due, { propertyId: PROPS.name, direction: 'asc' }],
    });
  });
});
