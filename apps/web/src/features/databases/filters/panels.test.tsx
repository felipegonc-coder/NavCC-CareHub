import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jobsDatabase, testViewer } from '../fixtures';
import { mockActions, renderWithDatabase } from '../test-utils';
import { ViewPanels, type PanelRequest } from './panels';

function stubResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === 'function') return;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}

function setup() {
  const meta = jobsDatabase();
  const [view] = meta.views;
  if (!view) throw new Error('No view');
  const anchor = document.createElement('button');
  anchor.textContent = 'Filter';
  document.body.append(anchor);
  const onClose = vi.fn<() => void>();
  const props = { meta, view, viewer: testViewer(), actions: mockActions(), onClose };
  const ui = (request: PanelRequest | null) => <ViewPanels {...props} request={request} />;
  return { anchor, onClose, ui };
}

describe('ViewPanels', () => {
  beforeEach(() => {
    stubResizeObserver();
    document.body.innerHTML = '';
  });

  it('opens the Filter panel for the button that asked, and closes on Escape', () => {
    const { anchor, onClose, ui } = setup();
    const { rerender } = renderWithDatabase(ui(null));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(ui({ panel: 'filter', anchor }));
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(screen.getByRole('searchbox', { name: 'Filter by' })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('opens the advanced filter from its chip', () => {
    const { anchor, ui } = setup();
    renderWithDatabase(ui({ panel: 'filter', anchor, advanced: true }));
    expect(screen.getByRole('heading', { name: 'Advanced filter' })).toBeInTheDocument();
  });

  it('opens the Sort panel', () => {
    const { anchor, ui } = setup();
    renderWithDatabase(ui({ panel: 'sort', anchor }));
    expect(screen.getByRole('dialog', { name: 'Sorts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add sort' })).toBeInTheDocument();
  });
});
