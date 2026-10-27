import { HocuspocusProvider } from '@hocuspocus/provider';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { peopleOnPage, type Person } from './presence';
import * as socket from './socket';

export type ReadOnlyReason = 'access' | 'trashed' | 'locked';

/** What the server lets you do on the page (its `carehub.access` message). */
export interface PageAccess {
  /** Your access level, like `edit` or `view`. */
  level: string;
  readOnly: boolean;
  /** Why it's read-only: your access, the page is in Trash, or it's locked. */
  reason: ReadOnlyReason | null;
}

export type PageStatus = 'loading' | 'ready' | 'no-access' | 'failed';

/** A message above the editor, until it's dismissed. */
export type PageNotice = 'now-view-only' | 'too-long' | 'outdated' | 'signed-out';

export interface PageState {
  status: PageStatus;
  /** The page's blocks. Reloading from the server makes a new doc and a new `generation`. */
  doc: Y.Doc;
  provider: HocuspocusProvider;
  generation: number;
  access: PageAccess | null;
  /** You can type: the page is loaded, you may edit it and this tab can still send changes. */
  editable: boolean;
  /** Connected and signed in to the page: changes go out right away. */
  live: boolean;
  /** Not live for 3 s or more ("Reconnecting…"). Typing goes on. */
  reconnecting: boolean;
  /** You made changes here that the server hasn't confirmed yet. */
  unsent: boolean;
  notice: PageNotice | null;
  /** The other people who have the page open. */
  people: Person[];
}

const LOCAL_LOAD_MS = 3000;
const RECONNECTING_MS = 3000;
/** Rejoins and reloads allowed per minute before the page shows an error. */
const RETRIES_PER_MINUTE = 3;

const localName = (userId: string, pageId: string) => `carehub-page:${userId}:${pageId}`;
const locks = () =>
  typeof navigator === 'undefined' ? undefined : (navigator.locks as LockManager | undefined);
const delay = (ms: number) => new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));

function deleteLocalCopy(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    const done = () => resolve();
    request.onsuccess = done;
    request.onerror = done;
    request.onblocked = done;
  });
}

function parseAccess(payload: string): (PageAccess & { build: unknown }) | null {
  let message: unknown;
  try {
    message = JSON.parse(payload);
  } catch {
    return null;
  }
  const { type, build, level, readOnly, reason } = (message ?? {}) as Record<string, unknown>;
  if (type !== 'carehub.access' || typeof level !== 'string' || typeof readOnly !== 'boolean') {
    return null;
  }
  const why = reason === 'access' || reason === 'trashed' || reason === 'locked' ? reason : null;
  return { build, level, readOnly, reason: why };
}

/**
 * One open page: its Y.Doc, kept on this device (IndexedDB) and live through the tab's socket.
 * Get one with `acquirePage` (or `useCollabPage`).
 */
export class PageSession {
  readonly key: string;
  private readonly name: string;
  private readonly listeners = new Set<() => void>();
  private readonly locked: Promise<unknown>;
  private unlock: (() => void) | undefined;
  private state!: PageState;
  private doc!: Y.Doc;
  private provider!: HocuspocusProvider;
  private hasProvider = false;
  private local: IndexeddbPersistence | null = null;
  private generation = 0;
  private status: PageStatus = 'loading';
  private access: PageAccess | null = null;
  private notice: PageNotice | null = null;
  private people: Person[] = [];
  /** Changes typed here since the server last confirmed it has everything. */
  private edited = false;
  /** The server has everything this device has of the page. */
  private confirmed = false;
  /** Outdated or signed out: the page stays on screen, but nothing more is sent. */
  private stopped = false;
  private closed = false;
  private slow = false;
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  private retries: number[] = [];

  constructor(
    readonly userId: string,
    readonly pageId: string,
  ) {
    this.key = `${userId}:${pageId}`;
    this.name = localName(userId, pageId);
    // Held while the page is open here, so another tab never deletes its copy meanwhile.
    const request = locks()?.request(this.name, { mode: 'shared' }, () =>
      this.closed ? undefined : new Promise<void>((resolve) => (this.unlock = resolve)),
    );
    this.locked = request?.catch(() => undefined) ?? Promise.resolve();
    this.open();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  getState = () => this.state;

  dismissNotice(): void {
    this.notice = null;
    this.publish();
  }

  retry(): void {
    if (this.closed || this.status !== 'failed') return;
    this.retries = [];
    this.open();
  }

  /** The server doesn't have everything yet, so the page shouldn't close yet. */
  get waiting(): boolean {
    return !this.confirmed && this.running;
  }

  private get running(): boolean {
    return !this.closed && !this.stopped && (this.status === 'loading' || this.status === 'ready');
  }

  private open(): void {
    const doc = new Y.Doc();
    // Made now, so the editor has its awareness from the start, but attached only once the local
    // copy is in: otherwise the whole copy would go out as one change (the sync sends only what
    // the server lacks).
    const provider: HocuspocusProvider = new HocuspocusProvider({
      name: this.pageId,
      document: doc,
      websocketProvider: socket.retainSocket(),
      onAuthenticated: () => this.publish(),
      onAuthenticationFailed: ({ reason }) => this.later(provider, () => this.refused(reason)),
      onStateless: ({ payload }) => this.receive(provider, payload),
      onSynced: () => this.loaded(provider),
      onUnsyncedChanges: ({ number }) => {
        if (number === 0 && this.provider === provider) {
          this.edited = false;
          this.confirmed = true;
        }
        this.publish();
      },
      onClose: ({ event }) => this.closedBy(provider, event),
      onStatus: () => this.publish(),
      onAwarenessChange: () => this.updatePeople(),
    });
    const local =
      typeof indexedDB === 'undefined' ? null : new IndexeddbPersistence(this.name, doc);
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin === provider || (local !== null && origin === local)) return;
      this.edited = true;
      this.confirmed = false;
      this.publish();
    });
    this.doc = doc;
    this.provider = provider;
    this.hasProvider = true;
    this.local = local;
    this.generation += 1;
    this.status = 'loading';
    this.access = null;
    this.edited = false;
    this.confirmed = false;
    this.publish();
    const loaded = local
      ? Promise.race([local.whenSynced.then(() => true), delay(LOCAL_LOAD_MS)])
      : delay(0);
    void loaded.then((ok) => {
      if (this.provider !== provider || !this.running) return;
      // Too slow: go on without it. What it holds goes out the next time the page opens.
      if (!ok) void this.dropLocal();
      if (doc.store.clients.size > 0) this.loaded(provider);
      provider.attach();
    });
  }

  /** Runs `fn` after the provider's own handling, if the page still uses that provider. */
  private later(provider: HocuspocusProvider, fn: () => void): void {
    setTimeout(() => {
      if (this.provider === provider && !this.closed) fn();
    }, 0);
  }

  private loaded(provider: HocuspocusProvider): void {
    if (this.provider !== provider || this.status !== 'loading') return;
    this.status = 'ready';
    this.publish();
  }

  private refused(reason: string): void {
    if (reason === 'outdated') this.stop('outdated');
    else if (reason === 'forbidden') void this.lose();
    else this.fail();
  }

  private receive(provider: HocuspocusProvider, payload: string): void {
    const message = parseAccess(payload);
    if (!message || this.provider !== provider || !this.running) return;
    if (message.build !== socket.BUILD) return this.later(provider, () => this.stop('outdated'));
    const access = { level: message.level, readOnly: message.readOnly, reason: message.reason };
    const before = this.access;
    if (before && before.readOnly !== access.readOnly) {
      if (access.readOnly && access.reason === 'access') this.notice = 'now-view-only';
      else if (this.notice === 'now-view-only') this.notice = null;
      // Changes the server refused while the page was read-only go out now.
      if (!access.readOnly && !this.confirmed) provider.forceSync();
    }
    this.access = access;
    this.publish();
  }

  private closedBy(provider: HocuspocusProvider, event: unknown): void {
    this.publish();
    // The socket reconnects on its own; socket.ts deals with its problems.
    if (socket.isSocketClose(event)) return;
    const reason = (event as { reason?: unknown } | null)?.reason;
    this.later(provider, () => {
      if (reason === 'forbidden') void this.lose();
      else if (reason === 'too-long') void this.reload('too-long');
      else if (reason === 'signed-out') this.stop('signed-out');
      // The socket closes right after and waits before it reconnects.
      else if (reason === 'too-fast') return;
      else if (!this.mayRetry()) this.fail();
      else {
        // For example a close this tab queued while offline, for an earlier provider.
        provider.detach();
        provider.attach();
      }
    });
  }

  socketProblem(problem: socket.SocketProblem): void {
    if (problem === 'signed-out') this.stop('signed-out');
    // A message too big for the server: drop the changes it can't take.
    else if (this.edited && this.running) void this.reload('too-long');
  }

  private mayRetry(): boolean {
    const now = Date.now();
    this.retries = this.retries.filter((at) => now - at < 60_000);
    if (this.retries.length >= RETRIES_PER_MINUTE) return false;
    this.retries.push(now);
    return true;
  }

  private dropProvider(): void {
    if (!this.hasProvider) return;
    this.hasProvider = false;
    this.people = [];
    this.provider.destroy();
    socket.releaseSocket();
  }

  private async dropLocal(): Promise<void> {
    const local = this.local;
    this.local = null;
    await local?.destroy();
  }

  /** Deletes this device's copy of the page, with any changes it holds. */
  private async deleteLocal(): Promise<void> {
    await this.dropLocal();
    if (typeof indexedDB !== 'undefined') await deleteLocalCopy(this.name);
  }

  private stop(notice: PageNotice): void {
    if (!this.running) return;
    this.stopped = true;
    this.notice = notice;
    this.dropProvider();
    this.publish();
  }

  private fail(): void {
    this.status = 'failed';
    this.dropProvider();
    void this.dropLocal();
    this.publish();
  }

  /** No access any more: nothing of the page stays on screen or on this device. */
  private async lose(): Promise<void> {
    this.status = 'no-access';
    this.notice = null;
    this.dropProvider();
    this.publish();
    await this.deleteLocal();
  }

  /** Loads the page from the server again, dropping what only this device has. */
  private async reload(notice: PageNotice): Promise<void> {
    if (!this.mayRetry()) return this.fail();
    this.status = 'loading';
    this.notice = notice;
    this.dropProvider();
    this.publish();
    await this.deleteLocal();
    if (this.status === 'loading' && !this.closed && !this.stopped) this.open();
  }

  /** Lets go of the page. Its copy here is deleted if the server has everything. */
  close(): void {
    if (this.closed) return;
    const forget = this.confirmed;
    this.closed = true;
    clearTimeout(this.slowTimer);
    this.dropProvider();
    this.listeners.clear();
    this.unlock?.();
    void this.dropLocal().then(async () => {
      await this.locked;
      // Only if no other tab has the page open (and never without Web Locks).
      if (forget) {
        await locks()?.request(this.name, { mode: 'exclusive', ifAvailable: true }, (lock) =>
          lock ? deleteLocalCopy(this.name) : undefined,
        );
      }
      this.doc.destroy();
    });
  }

  private updatePeople(): void {
    const states = this.provider.awareness?.getStates();
    const people = states ? peopleOnPage(states, this.doc.clientID, this.userId) : [];
    if (JSON.stringify(people) === JSON.stringify(this.people)) return;
    this.people = people;
    this.publish();
  }

  private publish(): void {
    const running = this.running;
    const live =
      running && this.hasProvider && this.provider.isAuthenticated && socket.socketConnected();
    if (live || !running) {
      clearTimeout(this.slowTimer);
      this.slowTimer = undefined;
      this.slow = false;
    } else if (!this.slow && !this.slowTimer) {
      this.slowTimer = setTimeout(() => {
        this.slowTimer = undefined;
        this.slow = true;
        this.publish();
      }, RECONNECTING_MS);
    }
    const access = this.access;
    const next: PageState = {
      status: this.status,
      doc: this.doc,
      provider: this.provider,
      generation: this.generation,
      access,
      editable: running && this.status === 'ready' && access?.readOnly === false,
      live,
      reconnecting: this.slow,
      unsent: running && this.edited && access?.readOnly !== true,
      notice: this.notice,
      people: this.people,
    };
    const before = this.state as PageState | undefined;
    if (before && (Object.keys(next) as (keyof PageState)[]).every((k) => next[k] === before[k])) {
      return;
    }
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

/** Pages are closed this long after the last user lets go, or once their changes are out. */
const CLOSE_AFTER_MS = 1000;
/** A page with changes still to send stays open in the background this long at most. */
const KEEP_WAITING_MS = 10 * 60_000;

interface Entry {
  session: PageSession;
  users: number;
  timer?: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Entry>();
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // Closing the tab with unsent changes asks first.
  window.addEventListener('beforeunload', (event) => {
    if (hasUnsentChanges()) event.preventDefault();
  });
  socket.onSocketProblem((problem) =>
    sessions.forEach(({ session }) => session.socketProblem(problem)),
  );
}

function closeEntry(entry: Entry): void {
  clearTimeout(entry.timer);
  sessions.delete(entry.session.key);
  entry.session.close();
}

/** Opens `pageId` for `userId` (or shares the open one). Call `releasePage` when done. */
export function acquirePage(userId: string, pageId: string): PageSession {
  install();
  sessions.forEach((entry) => {
    if (entry.session.userId !== userId) closeEntry(entry);
  });
  const key = `${userId}:${pageId}`;
  let entry = sessions.get(key);
  if (!entry) {
    entry = { session: new PageSession(userId, pageId), users: 0 };
    sessions.set(key, entry);
  }
  clearTimeout(entry.timer);
  entry.users += 1;
  return entry.session;
}

/** Lets go of a page. It closes once nobody uses it and its changes are sent (10 min at most). */
export function releasePage(session: PageSession): void {
  const entry = sessions.get(session.key);
  if (!entry || entry.session !== session || entry.users === 0) return;
  entry.users -= 1;
  if (entry.users > 0) return;
  const releasedAt = Date.now();
  const check = () => {
    if (entry.users > 0) return;
    if (session.waiting && Date.now() - releasedAt < KEEP_WAITING_MS) {
      entry.timer = setTimeout(check, CLOSE_AFTER_MS);
    } else closeEntry(entry);
  };
  entry.timer = setTimeout(check, CLOSE_AFTER_MS);
}

export function hasUnsentChanges(): boolean {
  return [...sessions.values()].some(({ session }) => session.getState().unsent);
}

async function storedPages(userId: string): Promise<string[]> {
  if (typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') return [];
  const prefix = localName(userId, '');
  const databases = await indexedDB.databases().catch((): IDBDatabaseInfo[] => []);
  return databases.flatMap(({ name }) =>
    name?.startsWith(prefix) ? [name.slice(prefix.length)] : [],
  );
}

/**
 * Sends changes kept on this device from earlier visits (say, the browser closed while
 * offline): opens each such page in the background until it's sent. Run once after sign-in.
 */
export async function sendWaitingChanges(userId: string): Promise<void> {
  for (const pageId of await storedPages(userId)) releasePage(acquirePage(userId, pageId));
}

/** Closes `userId`'s pages and deletes their copies on this device, for signing out. */
export async function forgetLocalCopies(userId: string): Promise<void> {
  sessions.forEach((entry) => {
    if (entry.session.userId === userId) closeEntry(entry);
  });
  await Promise.all(
    (await storedPages(userId)).map((id) => deleteLocalCopy(localName(userId, id))),
  );
}
