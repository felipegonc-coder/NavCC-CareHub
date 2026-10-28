import type { Property } from '@carehub/databases';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SettingsAnswer } from '../api';
import { jobsDatabase, jobsProperties, PROPS, testViewer } from '../fixtures';
import { DeletedProperties, type DeletedProperty } from './deleted-properties';
import { PROPERTY_TEXT } from './messages';
import { settle } from './test-helpers';

const property = (id: string): Property => {
  const found = jobsProperties().find((p) => p.id === id);
  if (!found) throw new Error(`no property ${id}`);
  return found;
};

// 9:30 PM on Oct 20 in Denver, and noon on Oct 26.
const deleted: DeletedProperty[] = [
  { property: property(PROPS.cost), deletedAt: '2026-10-21T03:30:00.000Z' },
  { property: property(PROPS.notes), deletedAt: '2026-10-26T18:00:00.000Z' },
];

function renderList(canRestore = true, restore = vi.fn(() => Promise.resolve(jobsDatabase()))) {
  const onRestored = vi.fn();
  const onError = vi.fn();
  render(
    <DeletedProperties
      deleted={deleted}
      actions={{ restore }}
      viewer={testViewer()}
      canRestore={canRestore}
      onRestored={onRestored}
      onError={onError}
    />,
  );
  return { restore, onRestored, onError };
}

describe('DeletedProperties', () => {
  it('lists each property with the day it was deleted, in the viewer’s time zone', () => {
    renderList();
    const list = screen.getByRole('list', { name: PROPERTY_TEXT.deletedList });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Cost');
    expect(items[0]).toHaveTextContent('Deleted Oct 20, 2026');
    expect(items[1]).toHaveTextContent('Deleted Oct 26, 2026');
  });

  it('restores one and says so', async () => {
    const pending: { finish?: (answer: SettingsAnswer) => void } = {};
    const restore = vi.fn(
      () =>
        new Promise<SettingsAnswer>((resolve) => {
          pending.finish = resolve;
        }),
    );
    const { onRestored } = renderList(true, restore);
    const button = screen.getByRole('button', { name: 'Restore Cost' });
    fireEvent.click(button);
    expect(restore).toHaveBeenCalledWith(PROPS.cost);
    expect(button).toHaveAttribute('aria-busy', 'true');

    pending.finish?.(jobsDatabase());
    await settle();
    expect(onRestored).toHaveBeenCalledWith(property(PROPS.cost));
    expect(button).not.toHaveAttribute('aria-busy');
  });

  it('reports a restore the server refused', async () => {
    const refused = new Error('Refused');
    const { onError, onRestored } = renderList(
      true,
      vi.fn(() => Promise.reject(refused)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Restore Notes' }));
    await settle();
    expect(onError).toHaveBeenCalledWith(refused);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('shows the list without Restore to people who cannot change properties', () => {
    renderList(false);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says when nothing was deleted', () => {
    render(
      <DeletedProperties
        deleted={[]}
        actions={{ restore: vi.fn() }}
        viewer={testViewer()}
        canRestore
      />,
    );
    expect(screen.getByText(PROPERTY_TEXT.noDeleted)).toBeInTheDocument();
  });
});
