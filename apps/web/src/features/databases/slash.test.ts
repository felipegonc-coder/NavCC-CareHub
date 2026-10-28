import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { JOBS_ID, jobsDatabase } from './fixtures';
import { addDatabaseBlock, databaseSlashItem } from './slash';

const PAGE = 'page-intake';

/** Stands in for the Tiptap editor, with the cursor at `from`. */
function fakeEditor(from = 7) {
  return {
    isDestroyed: false,
    state: { doc: { version: 1 } as unknown, selection: { from } },
    commands: { insertContentAt: vi.fn(() => true) },
  };
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: Mock<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(async () => answer(201, jobsDatabase({ inline: true })));
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'carehub_csrf=csrf-1; path=/';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = 'carehub_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  window.history.replaceState(null, '', '/');
});

describe('addDatabaseBlock', () => {
  it('makes an inline database in the page and adds its block where the cursor was', async () => {
    const editor = fakeEditor(7);
    await addDatabaseBlock(editor, PAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/databases');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ parentId: 'page-intake', inline: true });
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('csrf-1');
    expect(editor.commands.insertContentAt).toHaveBeenCalledWith(7, {
      type: 'database',
      attrs: { databaseId: JOBS_ID },
    });
  });

  it('adds the block at the cursor when the page changed while waiting', async () => {
    const editor = fakeEditor(7);
    let reply: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (reply = resolve)));
    const adding = addDatabaseBlock(editor, PAGE);
    editor.state = { doc: { version: 2 }, selection: { from: 12 } };
    reply(answer(201, jobsDatabase()));
    await adding;
    expect(editor.commands.insertContentAt).toHaveBeenCalledWith(12, expect.anything());
  });

  it('adds nothing once the editor is gone', async () => {
    const editor = fakeEditor();
    let reply: (response: Response) => void = () => undefined;
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => (reply = resolve)));
    const adding = addDatabaseBlock(editor, PAGE);
    editor.isDestroyed = true;
    reply(answer(201, jobsDatabase()));
    await adding;
    expect(editor.commands.insertContentAt).not.toHaveBeenCalled();
  });

  it('refuses without a page, without asking the server', async () => {
    const editor = fakeEditor();
    await expect(addDatabaseBlock(editor, null)).rejects.toThrow('"/database" needs the page');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(editor.commands.insertContentAt).not.toHaveBeenCalled();
  });

  it("passes on the server's refusal and adds nothing", async () => {
    fetchMock.mockResolvedValue(
      answer(403, { error: { code: 'forbidden', message: "You can't edit this page." } }),
    );
    const editor = fakeEditor();
    await expect(addDatabaseBlock(editor, PAGE)).rejects.toMatchObject({
      status: 403,
      message: "You can't edit this page.",
    });
    expect(editor.commands.insertContentAt).not.toHaveBeenCalled();
  });
});

describe('databaseSlashItem', () => {
  it('is "Database" under the Database heading', () => {
    expect(databaseSlashItem).toMatchObject({
      id: 'database',
      title: 'Database',
      group: 'Database',
    });
    expect(databaseSlashItem.icon).toBeTruthy();
  });

  it('adds the block to the page the editor gives, not the one in the address', async () => {
    window.history.replaceState(null, '', '/p/page-other');
    const editor = fakeEditor(3);
    databaseSlashItem.run(editor, { pageId: PAGE });
    await vi.waitFor(() =>
      expect(editor.commands.insertContentAt).toHaveBeenCalledWith(3, {
        type: 'database',
        attrs: { databaseId: JOBS_ID },
      }),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ parentId: PAGE, inline: true });
  });

  it('logs a failure instead of throwing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const editor = fakeEditor();
    expect(() => databaseSlashItem.run(editor, { pageId: PAGE })).not.toThrow();
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith("Couldn't add the database.", expect.anything()),
    );
    expect(editor.commands.insertContentAt).not.toHaveBeenCalled();
  });

  it('logs instead of asking the server when the editor has no page', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const editor = fakeEditor();
    databaseSlashItem.run(editor, { pageId: null });
    await vi.waitFor(() =>
      expect(logged).toHaveBeenCalledWith("Couldn't add the database.", expect.anything()),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(editor.commands.insertContentAt).not.toHaveBeenCalled();
  });
});
