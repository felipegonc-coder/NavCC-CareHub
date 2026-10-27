import { restoreNote, restoreQuestion, versionDate, versionLine } from '@carehub/extras/history';
import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveClientForTest } from '../live/client';
import { createFakeLive } from '../live/testSource';
import {
  fakeHistoryServer,
  fakeVersion,
  PAGE_ID,
  SAM,
  AVERY,
  TOO_OLD,
  type FakeHistoryOptions,
  type FakeVersion,
} from './testServer';
import { groupByDay } from './versionList';
import { VersionHistory } from './VersionHistory';

const realFetch = globalThis.fetch;
let live: ReturnType<typeof createFakeLive>;
let server: ReturnType<typeof fakeHistoryServer>;
let onClose = vi.fn();

const VERSIONS = (): FakeVersion[] => [
  fakeVersion('v-4', 5, 'Call the member today.', { editors: [AVERY, SAM] }),
  fakeVersion('v-3', 60, 'Email the member.', { name: 'Before the Nov policy change' }),
  fakeVersion('v-2', 26 * 60, 'Write to the member.', {
    kind: 'before_restore',
    editors: [],
    createdBy: SAM,
  }),
  fakeVersion('v-1', 50 * 60, 'Use the old fax line.'),
];

function show(
  options: FakeHistoryOptions & { versions?: FakeVersion[]; initialVersionId?: string } = {},
) {
  const { versions = VERSIONS(), initialVersionId = null, ...rest } = options;
  server = fakeHistoryServer(versions, rest);
  globalThis.fetch = server.fetch;
  onClose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <VersionHistory pageId={PAGE_ID} initialVersionId={initialVersionId} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

/** Dates and times can hold narrow spaces; the text matchers see plain ones. */
const plain = (value: string) => value.replace(/\s+/g, ' ');

const versionRequests = (id: string) =>
  server.requests.filter((one) => one.url === `/api/history/pages/${PAGE_ID}/versions/${id}`);
const changes = () => server.requests.filter((one) => one.method !== 'GET');

beforeEach(() => {
  live = createFakeLive();
  setLiveClientForTest(live.client);
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setLiveClientForTest(null);
  Reflect.deleteProperty(window.navigator, 'clipboard');
});

describe('Version history', () => {
  it('lists versions newest first, grouped by day, and shows the newest', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    const options = within(listbox).getAllByRole('option');
    const summaries = VERSIONS().map((one) => one.summary);

    expect(options).toHaveLength(4);
    options.forEach((option, index) =>
      expect(option).toHaveTextContent(plain(versionLine(summaries[index]!))),
    );
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(listbox).toHaveAttribute('aria-activedescendant', options[0]!.id);
    expect(within(options[1]!).getByText('Before the Nov policy change')).toHaveClass(
      'font-semibold',
    );
    expect(options[2]).toHaveTextContent('Sam Ortiz');
    expect(options[2]).toHaveTextContent('Before a restore');
    expect(
      within(listbox)
        .getAllByRole('group')
        .map((group) => group.ariaLabel),
    ).toEqual(groupByDay(summaries).map((group) => group.day));

    const preview = screen.getByRole('region', { name: 'Version preview' });
    await waitFor(() => expect(within(preview).getByRole('article')).toHaveTextContent('today'));
    await waitFor(() => expect(listbox).toHaveFocus());
  });

  it('↑ and ↓ move between versions, Home and End jump', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    const options = within(listbox).getAllByRole('option');
    const preview = screen.getByRole('region', { name: 'Version preview' });

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(listbox).toHaveAttribute('aria-activedescendant', options[1]!.id);
    await waitFor(() => expect(within(preview).getByRole('article')).toHaveTextContent('Email'));
    expect(versionRequests('v-3')).toHaveLength(1);

    fireEvent.keyDown(listbox, { key: 'End' });
    expect(options[3]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    expect(options[3]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(listbox, { key: 'Home' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('picks a version with a click, which on phones swaps the list for the preview', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    const preview = screen.getByRole('region', { name: 'Version preview' });
    const listPane = listbox.parentElement!;
    expect(preview).toHaveClass('max-md:hidden');
    expect(listPane).not.toHaveClass('max-md:hidden');

    fireEvent.click(within(listbox).getAllByRole('option')[2]!);
    expect(within(listbox).getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    expect(preview).not.toHaveClass('max-md:hidden');
    expect(listPane).toHaveClass('max-md:hidden');
    await waitFor(() => expect(within(preview).getByRole('article')).toHaveTextContent('Write'));

    fireEvent.click(within(preview).getByRole('button', { name: 'Versions' }));
    expect(preview).toHaveClass('max-md:hidden');
    expect(listPane).not.toHaveClass('max-md:hidden');
  });

  it('loads older versions with the button and near the end of the list', async () => {
    show({ pageSize: 2 });
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Show older versions' }));
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(4));
    expect(server.requests.map((one) => one.url)).toContain(
      `/api/history/pages/${PAGE_ID}/versions?before=v-3`,
    );
    expect(screen.queryByRole('button', { name: 'Show older versions' })).not.toBeInTheDocument();
  });

  it('loads the next versions when ↓ gets near the end', async () => {
    show({ pageSize: 2 });
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(4));
  });

  it('starts on the linked version', async () => {
    show({ initialVersionId: 'v-2' });
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    expect(within(listbox).getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(versionRequests('v-2')).toHaveLength(1));
    expect(versionRequests('v-4')).toHaveLength(0);
  });

  it('HT-04: Show changes is on at first and can be turned off', async () => {
    const { container } = show();
    const toggle = await screen.findByRole('switch', { name: 'Show changes' });
    expect(toggle).toBeChecked();
    await waitFor(() => expect(container.querySelector('ins')).not.toBeNull());

    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(container.querySelector('ins')).toBeNull();
    expect(container.querySelector('del')).toBeNull();
  });

  it('Copy link copies a link that opens this version', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    show();
    await screen.findByRole('listbox', { name: 'Versions' });

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/p/${PAGE_ID}?version=v-4`);
    expect(await screen.findByText('Link copied')).toBeInTheDocument();
  });

  it('shows the list again when a version is saved or someone restores', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    await act(() => live.open());
    expect(live.subscribed.has(`history:${PAGE_ID}`)).toBe(true);

    server.state.versions = [fakeVersion('v-5', 1, 'Call the member now.'), ...VERSIONS()];
    await act(async () => {
      live.send({ type: 'history.versions', data: { pageId: PAGE_ID } }, `history:${PAGE_ID}`);
    });
    await waitFor(() => expect(within(listbox).getAllByRole('option')).toHaveLength(5));
  });

  it('says so when there are no versions yet', async () => {
    show({ versions: [] });
    expect(
      await screen.findByText('Versions appear here after the first edits.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('HT-15: shows no access, and nothing about the page, on a 403', async () => {
    show({ listStatus: 403 });
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
    expect(screen.queryByText('Refund steps')).not.toBeInTheDocument();
  });

  it('shows not found on a 404', async () => {
    show({ listStatus: 404 });
    expect(await screen.findByText('This was deleted, or the link is wrong.')).toBeInTheDocument();
  });

  it('shows the error with Retry when the list fails', async () => {
    show({ listStatus: 500 });
    // Other errors are tried once more first.
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent('Something went wrong. Try again.');
    server.state.listStatus = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('listbox', { name: 'Versions' })).toBeInTheDocument();
  });

  it('says when a linked version is too old to show', async () => {
    show({ initialVersionId: 'v-gone' });
    expect(await screen.findByText(TOO_OLD)).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'Versions' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });
});

describe('restoring and naming versions', () => {
  const from = versionDate(VERSIONS()[1]!.summary.createdAt);

  it('HT-05: Restore this version asks first, then restores, shows the note and closes', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));

    const confirm = await screen.findByRole('dialog', { name: 'Restore this version?' });
    expect(confirm).toHaveAccessibleDescription(restoreQuestion(from));
    const restore = within(confirm).getByRole('button', { name: 'Restore' });
    await waitFor(() => expect(restore).toHaveFocus());

    fireEvent.click(restore);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(plain(restoreNote('Avery Lin', from)))).toBeInTheDocument();
    expect(changes()).toEqual([
      {
        method: 'POST',
        url: `/api/history/pages/${PAGE_ID}/versions/v-3/restore`,
        body: undefined,
      },
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Enter asks to restore the selected version, and Cancel changes nothing', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });

    const confirm = await screen.findByRole('dialog', { name: 'Restore this version?' });
    expect(confirm).toHaveAccessibleDescription(restoreQuestion(from));
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(changes()).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says why a restore failed, for example a page locked meanwhile', async () => {
    show({ changeError: { status: 403, message: 'This page is locked. Unlock it first.' } });
    await screen.findByRole('listbox', { name: 'Versions' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore this version' }));
    const confirm = await screen.findByRole('dialog', { name: 'Restore this version?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Restore' }));

    expect(await screen.findByText("Couldn't restore this version.")).toBeInTheDocument();
    expect(screen.getByText('This page is locked. Unlock it first.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it("HT-15: on a locked or archived page, says versions can't be restored or named", async () => {
    show({ canRestore: false });
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    expect(
      screen.getByText("The page is locked or archived, so versions can't be restored or named."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Name this version' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names a version, which then shows in bold', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    fireEvent.click(screen.getByRole('button', { name: 'Name this version' }));

    const dialog = await screen.findByRole('dialog', { name: 'Name this version' });
    expect(dialog).toHaveAccessibleDescription('Named versions are kept forever.');
    expect(within(dialog).queryByRole('button', { name: 'Remove name' })).not.toBeInTheDocument();
    const input = within(dialog).getByRole('textbox', { name: 'Name' });
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.change(input, { target: { value: ' Before the audit ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Version named')).toBeInTheDocument();
    expect(changes()).toEqual([
      {
        method: 'PATCH',
        url: `/api/history/pages/${PAGE_ID}/versions/v-4`,
        body: { name: 'Before the audit' },
      },
    ]);
    await waitFor(() =>
      expect(within(listbox).getByText('Before the audit')).toHaveClass('font-semibold'),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renames a named version, or removes its name', async () => {
    show();
    const listbox = await screen.findByRole('listbox', { name: 'Versions' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: 'Name this version' }));

    const dialog = await screen.findByRole('dialog', { name: 'Rename this version' });
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue(
      'Before the Nov policy change',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove name' }));
    expect(await screen.findByText('Name removed')).toBeInTheDocument();
    expect(changes()).toEqual([
      { method: 'PATCH', url: `/api/history/pages/${PAGE_ID}/versions/v-3`, body: { name: null } },
    ]);
    await waitFor(() =>
      expect(within(listbox).queryByText('Before the Nov policy change')).not.toBeInTheDocument(),
    );
  });

  it('keeps the name dialog open with the reason when the server refuses the name', async () => {
    const limit = 'This page has 100 named versions. Remove a name first.';
    show({ changeError: { status: 409, message: limit } });
    await screen.findByRole('listbox', { name: 'Versions' });
    fireEvent.click(screen.getByRole('button', { name: 'Name this version' }));

    const dialog = await screen.findByRole('dialog', { name: 'Name this version' });
    const input = within(dialog).getByRole('textbox', { name: 'Name' });
    fireEvent.change(input, { target: { value: 'Before the audit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(input).toHaveAccessibleDescription(limit));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog', { name: 'Name this version' })).toBeInTheDocument();
    expect(screen.queryByText('Version named')).not.toBeInTheDocument();
  });
});
