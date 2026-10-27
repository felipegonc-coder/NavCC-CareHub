import { archiveQuestion, type ArchiveState } from '@carehub/extras/history';
import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { closeArchive, isKnownArchived } from './archive';
import { ArchiveBanner } from './ArchiveBanner';
import { ArchiveDialog } from './ArchiveDialog';
import { slots } from './slots';
import { SAM } from './testServer';

const realFetch = globalThis.fetch;
const POLICIES = { id: 'page-policies', kind: 'page' as const, title: 'Policies' };
// Midday, so it's Oct 20 wherever the tests run.
const AT = '2026-10-20T18:00:00Z';
const OPEN: ArchiveState = { archived: null, canChange: true, subPages: 12 };
const ARCHIVED: ArchiveState = { archived: { by: SAM, at: AT }, canChange: true, subPages: 12 };

/** A fake archive API: GET answers the state; POST archives or unarchives, or answers `postStatus`. */
function serve(initial: ArchiveState, { postStatus = 200 } = {}): string[] {
  let state = initial;
  const posts: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (init?.method === 'POST') {
      const action = url.pathname.split('/').pop() ?? '';
      posts.push(action);
      if (postStatus !== 200) {
        const error = { code: 'forbidden', message: "You don't have access to this." };
        return json({ error }, postStatus);
      }
      state = action === 'archive' ? ARCHIVED : OPEN;
      return json({ pageId: POLICIES.id, title: 'Policies', subPages: 12 });
    }
    if (url.pathname === `/api/history/pages/${POLICIES.id}/archive`) return json(state);
    return json({ error: { code: 'not_found', message: 'Not found.' } }, 404);
  }) as typeof globalThis.fetch;
  return posts;
}

/** The page's banner and the confirm, as the page view and the shell draw them. */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`/p/${POLICIES.id}`]}>
          <ArchiveBanner page={POLICIES} />
          <ArchiveDialog />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function archiveItem() {
  const item = slots.pageMenuItems?.find((one) => one.id === 'history.archive');
  if (!item) throw new Error('No Archive menu item.');
  return item;
}

async function openConfirm() {
  act(() => archiveItem().onSelect(POLICIES));
  return screen.findByRole('dialog', { name: 'Archive “Policies”?' });
}

afterEach(() => {
  act(() => closeArchive());
  globalThis.fetch = realFetch;
});

describe('Archive', () => {
  it('HT-14: archives from the page menu, shows the banner and unarchives from it', async () => {
    const posts = serve(OPEN);
    renderPage();
    const item = archiveItem();
    expect(item.label).toBe('Archive');
    expect(item.isVisible?.({ ...POLICIES, kind: 'database' })).toBe(true);
    expect(item.isVisible?.({ ...POLICIES, kind: 'row' })).toBe(false);

    const dialog = await openConfirm();
    expect(await within(dialog).findByText(archiveQuestion(12))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(
      await screen.findByText('Archived “Policies” and its 12 sub-pages.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(await screen.findByText('Archived by Sam Ortiz on Oct 20, 2026')).toBeInTheDocument();
    expect(isKnownArchived(POLICIES.id)).toBe(true);
    expect(item.isVisible?.(POLICIES)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    expect(
      await screen.findByText('Unarchived “Policies” and its 12 sub-pages.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Archived by Sam Ortiz on Oct 20, 2026')).not.toBeInTheDocument(),
    );
    expect(item.isVisible?.(POLICIES)).toBe(true);
    expect(posts).toEqual(['archive', 'unarchive']);
  });

  it('HT-14: without Full access the banner has no Unarchive, and the confirm refuses', async () => {
    serve({ archived: { by: null, at: AT }, canChange: false, subPages: 0 });
    renderPage();
    expect(await screen.findByText('Archived on Oct 20, 2026')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Unarchive' })).not.toBeInTheDocument();
    expect(archiveItem().isVisible?.(POLICIES)).toBe(false);

    const dialog = await openConfirm();
    expect(await within(dialog).findByText('This page is already archived.')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('HT-15: says when the person lacks Full access, or the server refuses', async () => {
    serve({ archived: null, canChange: false, subPages: 0 });
    renderPage();
    let dialog = await openConfirm();
    expect(
      await within(dialog).findByText('Only people with Full access can archive this page.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    act(() => closeArchive());

    const posts = serve({ archived: null, canChange: true, subPages: 0 }, { postStatus: 403 });
    dialog = await openConfirm();
    expect(await within(dialog).findByText(archiveQuestion(0))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("Couldn't archive this page.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText("You don't have access to this.")).toBeInTheDocument();
    expect(posts).toEqual(['archive']);
  });
});
