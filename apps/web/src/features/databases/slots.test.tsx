import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeSlots } from '../../slots';
import { databaseSlashItem } from './slash';
import { DatabaseBlockSlot, DatabasePageSlot, slots } from './slots';
import { JOBS_ID, renderWithDatabase } from './test-utils';

vi.mock('./layouts', async () => {
  const { probeLayouts } = await import('./shell/test-layout');
  return { LAYOUTS: probeLayouts() };
});

beforeEach(() => {
  localStorage.clear();
});

describe('databases slots', () => {
  it('fill the page view, the editor block and the "/" menu', () => {
    const merged = mergeSlots([slots]);
    expect(merged.pageKindViews.database).toBe(DatabasePageSlot);
    expect(merged.editor.nodeViews).toEqual({ database: DatabaseBlockSlot });
    expect(merged.editor.slashItems).toEqual([databaseSlashItem]);
  });

  it('load the database page on first use', async () => {
    renderWithDatabase(<DatabasePageSlot page={{ id: JOBS_ID }} />, { route: `/p/${JOBS_ID}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByTestId('database')).toHaveAttribute('data-database-id', JOBS_ID);
  });

  it('load the inline block on first use', async () => {
    renderWithDatabase(<DatabaseBlockSlot node={{ attrs: { databaseId: JOBS_ID } }} />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Jobs' })).toBeInTheDocument();
  });
});
