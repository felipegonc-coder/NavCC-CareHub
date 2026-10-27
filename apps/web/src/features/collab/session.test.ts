import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquirePage,
  forgetLocalCopies,
  hasUnsentChanges,
  releasePage,
  sendWaitingChanges,
  type PageSession,
} from './session';
import { BUILD } from './socket';

const fake = vi.hoisted(() => {
  interface SocketConfig {
    onClose(data: { event: unknown }): void;
  }
  interface ProviderConfig {
    name: string;
    document: unknown;
    onAuthenticated(): void;
    onAuthenticationFailed(data: { reason: string }): void;
    onStateless(data: { payload: string }): void;
    onSynced(data: { state: boolean }): void;
    onUnsyncedChanges(data: { number: number }): void;
    onClose(data: { event: unknown }): void;
    onStatus(data: { status: string }): void;
    onAwarenessChange(data: { states: unknown[] }): void;
  }
  const sockets: FakeSocket[] = [];
  const providers: FakeProvider[] = [];
  const locals: FakeLocal[] = [];
  class FakeSocket {
    status = 'disconnected';
    shouldConnect = false;
    webSocket = null;
    connect = vi.fn(() => {
      this.shouldConnect = true;
      return Promise.resolve();
    });
    disconnect = vi.fn(() => {
      this.shouldConnect = false;
    });
    constructor(readonly configuration: SocketConfig) {
      sockets.push(this);
    }
  }
  class FakeProvider {
    isAuthenticated = false;
    awareness = { getStates: vi.fn(() => new Map<number, Record<string, unknown>>()) };
    attach = vi.fn();
    detach = vi.fn();
    destroy = vi.fn();
    forceSync = vi.fn();
    constructor(readonly configuration: ProviderConfig) {
      providers.push(this);
    }
  }
  /** This device's copy of a page (IndexedDB). `load()` finishes loading it. */
  class FakeLocal {
    load: () => void = () => {};
    readonly whenSynced: Promise<void>;
    destroy = vi.fn(() => Promise.resolve());
    constructor(readonly name: string) {
      this.whenSynced = new Promise<void>((resolve) => {
        this.load = () => resolve();
      });
      locals.push(this);
    }
  }
  return { sockets, providers, locals, FakeSocket, FakeProvider, FakeLocal };
});

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProvider: fake.FakeProvider,
  HocuspocusProviderWebsocket: fake.FakeSocket,
  WebSocketStatus: {
    Connecting: 'connecting',
    Connected: 'connected',
    Disconnected: 'disconnected',
  },
}));

vi.mock('y-indexeddb', () => ({ IndexeddbPersistence: fake.FakeLocal }));

type FakeProvider = InstanceType<typeof fake.FakeProvider>;

function last<T>(items: T[]): T {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error('None yet');
  return item;
}

const theSocket = () => last(fake.sockets);

/** Lets the page's next steps run: each waits for a timer or a promise. */
const settle = () => vi.advanceTimersByTimeAsync(10);

const opened: PageSession[] = [];
let pages = 0;

async function openPage(userId = 'user-1') {
  pages += 1;
  const session = acquirePage(userId, `page-${pages}`);
  opened.push(session);
  const provider = last(fake.providers);
  await settle();
  return { session, provider };
}

const accessMessage = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'carehub.access',
    build: BUILD,
    level: 'edit',
    readOnly: false,
    reason: null,
    ...patch,
  });

/** The server signs the tab in to the page, says what you may do and sends the page. */
function join(provider: FakeProvider, access: Record<string, unknown> = {}) {
  theSocket().status = 'connected';
  provider.isAuthenticated = true;
  provider.configuration.onAuthenticated();
  provider.configuration.onStateless({ payload: accessMessage(access) });
  provider.configuration.onSynced({ state: true });
}

/** The server closes just this page. */
function closePage(provider: FakeProvider, reason: string) {
  provider.configuration.onClose({ event: { code: 1000, reason } });
}

function edit(session: PageSession, text = 'typed here') {
  session.getState().doc.getMap('test').set('text', text);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  opened.splice(0).forEach((session) => releasePage(session));
  // Closes them all, even the ones still waiting to send.
  vi.advanceTimersByTime(11 * 60_000);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('a page session', () => {
  it('opens the page and lets you edit once the server has sent it', async () => {
    const { session, provider } = await openPage();
    expect(provider.configuration.name).toBe(session.pageId);
    expect(provider.configuration.document).toBe(session.getState().doc);
    expect(provider.attach).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({ status: 'loading', editable: false, live: false });

    join(provider);
    expect(session.getState()).toMatchObject({
      status: 'ready',
      editable: true,
      live: true,
      access: { level: 'edit', readOnly: false, reason: null },
    });
  });

  it('fills the page from this device first, then attaches', async () => {
    vi.stubGlobal('indexedDB', { deleteDatabase: vi.fn() });
    const { session, provider } = await openPage();
    const local = last(fake.locals);
    expect(local.name).toBe(`carehub-page:user-1:${session.pageId}`);
    expect(provider.attach).not.toHaveBeenCalled();

    const { doc } = session.getState();
    doc.transact(() => doc.getMap('test').set('text', 'kept here'), local);
    local.load();
    await settle();
    expect(provider.attach).toHaveBeenCalledTimes(1);
    // Shown before the server answers; what came from this device isn't a new change.
    expect(session.getState()).toMatchObject({ status: 'ready', unsent: false });
  });

  it("goes on without this device's copy when it takes over 3 s to load", async () => {
    vi.stubGlobal('indexedDB', { deleteDatabase: vi.fn() });
    const { provider } = await openPage();
    await vi.advanceTimersByTimeAsync(3000);
    expect(last(fake.locals).destroy).toHaveBeenCalled();
    expect(provider.attach).toHaveBeenCalledTimes(1);
  });

  it('lists the other people on the page once each', async () => {
    const { session, provider } = await openPage();
    join(provider);
    const sam = { id: 'user-2', name: 'Sam', fullName: 'Sam Lee', color: 'green' };
    provider.awareness.getStates.mockReturnValue(
      new Map<number, Record<string, unknown>>([
        [session.getState().doc.clientID, { user: { id: 'user-1', fullName: 'Robin Park' } }],
        [101, { user: sam }],
        [102, { user: sam }],
      ]),
    );
    provider.configuration.onAwarenessChange({ states: [] });
    const state = session.getState();
    expect(state.people).toEqual([{ ...sam, avatarUrl: null }]);

    provider.configuration.onAwarenessChange({ states: [] });
    expect(session.getState()).toBe(state);
  });

  it('says "Reconnecting" after 3 s offline, and typing goes on', async () => {
    const { session, provider } = await openPage();
    join(provider);
    const event = { code: 1006, reason: '' };
    theSocket().status = 'disconnected';
    theSocket().configuration.onClose({ event });
    provider.isAuthenticated = false;
    provider.configuration.onClose({ event });
    expect(session.getState()).toMatchObject({ live: false, reconnecting: false, editable: true });

    await vi.advanceTimersByTimeAsync(3000);
    expect(session.getState()).toMatchObject({ reconnecting: true, editable: true });
    edit(session);
    expect(session.getState().unsent).toBe(true);
    expect(provider.detach).not.toHaveBeenCalled();

    join(provider);
    expect(session.getState()).toMatchObject({ live: true, reconnecting: false, unsent: true });
  });

  it('counts your changes as unsent until the server confirms them', async () => {
    const { session, provider } = await openPage();
    join(provider);
    const { doc } = session.getState();
    doc.transact(() => doc.getMap('test').set('text', 'from someone else'), provider);
    expect(session.getState().unsent).toBe(false);

    edit(session);
    expect(session.getState().unsent).toBe(true);
    expect(hasUnsentChanges()).toBe(true);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    provider.configuration.onUnsyncedChanges({ number: 0 });
    expect(session.getState().unsent).toBe(false);
    expect(hasUnsentChanges()).toBe(false);
  });

  it('says when your access changes to view-only, and sends refused changes once you may edit', async () => {
    const { session, provider } = await openPage();
    join(provider);
    edit(session);
    const onAccess = (access: Record<string, unknown>) =>
      provider.configuration.onStateless({ payload: accessMessage(access) });

    onAccess({ level: 'view', readOnly: true, reason: 'access' });
    expect(session.getState()).toMatchObject({
      editable: false,
      unsent: false,
      notice: 'now-view-only',
    });
    expect(provider.forceSync).not.toHaveBeenCalled();

    onAccess({ level: 'edit' });
    expect(session.getState()).toMatchObject({ editable: true, unsent: true, notice: null });
    expect(provider.forceSync).toHaveBeenCalledTimes(1);

    onAccess({ level: 'edit', readOnly: true, reason: 'locked' });
    expect(session.getState()).toMatchObject({
      editable: false,
      notice: null,
      access: { reason: 'locked' },
    });
  });

  it('stops sending, and asks to reload, when Care Hub was updated', async () => {
    const { session, provider } = await openPage();
    join(provider);
    provider.configuration.onStateless({ payload: accessMessage({ build: 'a-newer-build' }) });
    await settle();
    expect(session.getState()).toMatchObject({ notice: 'outdated', editable: false });
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  });

  it('shows no access when the server refuses the page or your access is removed', async () => {
    const refused = await openPage();
    refused.provider.configuration.onAuthenticationFailed({ reason: 'forbidden' });
    const removed = await openPage();
    join(removed.provider);
    closePage(removed.provider, 'forbidden');
    await settle();
    for (const { session, provider } of [refused, removed]) {
      expect(session.getState().status).toBe('no-access');
      expect(provider.destroy).toHaveBeenCalledTimes(1);
    }
  });

  it('loads the page again from the server when it got too long', async () => {
    const { session, provider } = await openPage();
    join(provider);
    const before = session.getState();
    closePage(provider, 'too-long');
    await settle();
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    const reloaded = last(fake.providers);
    expect(reloaded).not.toBe(provider);
    expect(reloaded.attach).toHaveBeenCalledTimes(1);
    expect(session.getState()).toMatchObject({
      status: 'loading',
      generation: before.generation + 1,
      notice: 'too-long',
    });
    expect(session.getState().doc).not.toBe(before.doc);
    expect(session.getState().provider).toBe(reloaded);

    join(reloaded);
    expect(session.getState()).toMatchObject({ status: 'ready', editable: true });
    session.dismissNotice();
    expect(session.getState().notice).toBeNull();
  });

  it('loads the page again when a change was too big to send', async () => {
    const { session } = await openPage();
    join(last(fake.providers));
    edit(session, 'x'.repeat(100));
    theSocket().configuration.onClose({ event: { code: 1009 } });
    await settle();
    expect(session.getState()).toMatchObject({ generation: 2, notice: 'too-long' });
  });

  it('rejoins a page the server closed for another reason, 3 times a minute at most', async () => {
    const { session, provider } = await openPage();
    join(provider);
    for (let i = 0; i < 3; i += 1) {
      closePage(provider, 'restarting');
      await settle();
    }
    expect(provider.detach).toHaveBeenCalledTimes(3);
    expect(provider.attach).toHaveBeenCalledTimes(4);

    closePage(provider, 'restarting');
    await settle();
    expect(session.getState().status).toBe('failed');
    expect(provider.destroy).toHaveBeenCalledTimes(1);

    session.retry();
    await settle();
    expect(last(fake.providers)).not.toBe(provider);
    expect(session.getState()).toMatchObject({ status: 'loading', generation: 2 });
  });
});

describe('open pages', () => {
  it('stay open when opened again within a second', async () => {
    const { session, provider } = await openPage();
    releasePage(session);
    await vi.advanceTimersByTimeAsync(500);
    const again = acquirePage('user-1', session.pageId);
    opened.push(again);
    expect(again).toBe(session);
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.destroy).not.toHaveBeenCalled();
  });

  it('close once the server has your changes', async () => {
    const { session, provider } = await openPage();
    join(provider);
    edit(session);
    releasePage(session);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.destroy).not.toHaveBeenCalled();

    provider.configuration.onUnsyncedChanges({ number: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  });

  it('send changes kept on this device from earlier visits', async () => {
    vi.stubGlobal('indexedDB', {
      deleteDatabase: vi.fn(),
      databases: () =>
        Promise.resolve([
          { name: 'carehub-page:user-1:page-kept' },
          { name: 'carehub-page:user-2:page-other' },
          { name: 'something-else' },
        ]),
    });
    await sendWaitingChanges('user-1');
    const provider = last(fake.providers);
    expect(provider.configuration.name).toBe('page-kept');
    last(fake.locals).load();
    await settle();
    expect(provider.attach).toHaveBeenCalledTimes(1);

    join(provider);
    provider.configuration.onUnsyncedChanges({ number: 0 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.destroy).toHaveBeenCalledTimes(1);
  });

  it('are deleted from this device when you sign out', async () => {
    const deleteDatabase = vi.fn(() => {
      const request = { onsuccess: null as (() => void) | null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    });
    vi.stubGlobal('indexedDB', {
      deleteDatabase,
      databases: () => Promise.resolve([{ name: 'carehub-page:user-1:page-old' }]),
    });
    const { provider } = await openPage();
    await forgetLocalCopies('user-1');
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(deleteDatabase).toHaveBeenCalledWith('carehub-page:user-1:page-old');
  });

  it('close when someone else signs in on this tab', async () => {
    const mine = await openPage('user-1');
    const theirs = await openPage('user-2');
    expect(mine.provider.destroy).toHaveBeenCalledTimes(1);
    expect(theirs.provider.destroy).not.toHaveBeenCalled();
  });

  it('all stop when the server signs you out', async () => {
    const first = await openPage();
    const second = await openPage();
    join(first.provider);
    join(second.provider);
    theSocket().configuration.onClose({ event: { code: 4401 } });
    for (const { session, provider } of [first, second]) {
      expect(session.getState()).toMatchObject({ notice: 'signed-out', editable: false });
      expect(provider.destroy).toHaveBeenCalledTimes(1);
    }
  });
});
