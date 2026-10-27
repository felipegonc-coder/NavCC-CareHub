import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DragEvent } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startDrag } from './drag';
import TrashLink from './TrashLink';
import type { TreeNode } from './types';

const { api, toast } = vi.hoisted(() => ({
  api: {
    get: vi.fn<(path: string) => Promise<unknown>>(),
    post: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
    delete: vi.fn<(path: string, body?: unknown) => Promise<unknown>>(),
  },
  toast: vi.fn(),
}));
vi.mock('../../lib/api', () => ({ api, ApiError: class extends Error {} }));
vi.mock('@carehub/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@carehub/ui')>()),
  useToast: () => ({ toast }),
}));

const page = (access: TreeNode['access']): TreeNode => ({
  id: 'a1',
  parentId: null,
  kind: 'page',
  title: 'Onboarding',
  icon: null,
  position: 'a',
  hasChildren: false,
  access,
});

function renderLink() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TrashLink />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('link', { name: 'Trash' });
}

/** Picks `entry` up as the sidebar tree does, then drops it on `target`. */
function drop(entry: TreeNode, target: HTMLElement) {
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  startDrag({ dataTransfer } as unknown as DragEvent, entry);
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.delete.mockResolvedValue(null);
});

describe('TrashLink', () => {
  it('opens Trash', () => {
    expect(renderLink()).toHaveAttribute('href', '/trash');
  });

  it('moves an entry dropped on it to Trash', async () => {
    drop(page('full'), renderLink());
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/pages/a1'));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Moved to Trash' })),
    );
  });

  it("doesn't take an entry the person may not delete", () => {
    drop(page('edit'), renderLink());
    expect(api.delete).not.toHaveBeenCalled();
  });
});
