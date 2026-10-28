import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS, testViewer } from '../fixtures';
import { mockActions, renderWithDatabase } from '../test-utils';
import PropertiesEntry from './properties-entry';

describe('Properties panel in the shell', () => {
  it('saves a change to the view for everyone through updateView', () => {
    const meta = jobsDatabase();
    const [view] = meta.views;
    if (!view) throw new Error('No view');
    const actions = mockActions();
    renderWithDatabase(
      <PropertiesEntry
        panel="properties"
        meta={meta}
        view={view}
        savedView={view}
        viewer={testViewer()}
        actions={actions}
        canEditViews
        close={vi.fn<() => void>()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide Notes' }));
    expect(actions.updateView).toHaveBeenCalledWith({
      properties: view.properties.map((s) =>
        s.propertyId === PROPS.notes ? { ...s, visible: false } : s,
      ),
    });
  });
});
