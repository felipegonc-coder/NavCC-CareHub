import { STATUS_CODES, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { atLeast, type AccessLevel } from '@carehub/shared';
import { Hocuspocus, type Connection, type Document as LiveDocument } from '@hocuspocus/server';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Db } from '../../db';
import { SESSION_COOKIE, getUserFromSessionToken } from '../auth';
import { checkUpdate, pageSchemaInfo, pageSize, type PageSize } from './check';
import { getPageAccess, getPageState } from './page-access';
import { readMessageHead } from './protocol';
import { MERGE_ORIGIN, loadState, mergeStored, saveDoc, setLiveDocs } from './store';
import { isRecord } from './ydoc';

const PING_MS = 2_000;
/** Hocuspocus drops a socket that sends nothing, not even a pong, for this long. */
const TIMEOUT_MS = 6_000;
/** Before a change, access is checked again if the last check is older than this. */
const RECHECK_MS = 1_000;
const SWEEP_MS = 30_000;
/** The longest message a socket may send; ws would take 100 MiB. Holds MAX_TEXT_CHARS of text. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
/** What one socket may send: a steady rate, with room for bursts (opening pages, pasting). */
const MESSAGES_PER_SECOND = 50;
const MESSAGE_BURST = 200;
const BYTES_PER_SECOND = 1024 * 1024;
const BYTE_BURST = 8 * 1024 * 1024;
const MAX_SOCKETS_PER_USER = 20;
const MAX_CLIENTS_PER_CONNECTION = 8;
const MAX_AWARENESS_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Caret and avatar colours: names from the @carehub/ui palette (the web shows `--ch-<name>-text`),
 * picked from the user ID so a person looks the same everywhere.
 */
const PRESENCE_COLORS = ['blue', 'pink', 'green', 'orange', 'purple', 'red', 'brown', 'yellow'];
/** Core events after which open pages may turn read-only or close (decision 0007, 2.4). */
const ACCESS_EVENTS = [
  'access.changed',
  'member.removed',
  'member.roleChanged',
  'page.trashed',
  'page.restored',
  'page.deleted',
];

/** WebSocket close codes the web client acts on. */
export const CloseCode = {
  SignedOut: 4401,
  Forbidden: 4403,
  TooLong: 4413,
  TooFast: 4429,
} as const;

const CLOSE_REASONS: Record<number, string> = {
  [CloseCode.SignedOut]: 'signed-out',
  [CloseCode.Forbidden]: 'forbidden',
  [CloseCode.TooLong]: 'too-long',
  [CloseCode.TooFast]: 'too-fast',
};

export interface CollabServerOptions {
  /** The WebSocket's path, /api/collab. */
  path: string;
  /** CAREHUB_VERSION: a tab from another build must reload before it can open a page. */
  build: string;
  /** CAREHUB_PUBLIC_URL: sockets opened from any other origin are refused. */
  publicUrl?: string | undefined;
}

type ReadOnlyReason = 'access' | 'trashed' | 'locked';

interface PageAccess {
  level: AccessLevel;
  readOnly: boolean;
  reason: ReadOnlyReason | null;
  checkedAt: number;
}

interface Presence {
  id: string;
  name: string;
  fullName: string;
  avatarUrl: string | null;
  color: string;
}

interface Socket {
  ws: WebSocket;
  token: string;
  userId: string;
}

/** The Hocuspocus context of one page connection. */
interface CollabContext {
  socket: Socket;
  presence: Presence;
  access?: PageAccess;
}

/** Core events, typed loosely here because core owns their payload types. */
interface Events {
  emit(name: string, payload: object): void;
  on(name: string, handler: (payload: unknown) => void): () => void;
}

/** Thrown in onAuthenticate: the client is told "permission denied" with this reason. */
class Refusal {
  readonly reason: 'forbidden' | 'outdated';

  constructor(reason: 'forbidden' | 'outdated') {
    this.reason = reason;
  }
}

/** Thrown before a message is handled: Hocuspocus closes the page connection with this code. */
class CloseRequest {
  readonly code: number;
  readonly reason: string;

  constructor(code: number, reason: string) {
    this.code = code;
    this.reason = reason;
  }
}

function contextOf(connection: Connection): CollabContext {
  return connection.context as CollabContext;
}

export function startCollabServer(app: FastifyInstance, options: CollabServerOptions): void {
  const { path, build, publicUrl } = options;
  const db = app.db;
  const events = app.events as unknown as Events;
  const info = pageSchemaInfo();
  const sizes = new WeakMap<Y.Doc, PageSize>();
  const sockets = new Set<Socket>();
  const socketsPerUser = new Map<string, number>();

  const hocuspocus = new Hocuspocus({
    timeout: TIMEOUT_MS,
    debounce: 2_000,
    maxDebounce: 10_000,

    async onAuthenticate({ context, documentName, requestParameters, connectionConfig }) {
      const { socket } = context as CollabContext;
      if (!UUID.test(documentName)) throw new Refusal('forbidden');
      // A tab from another build must not load blocks it may not know: its editor deletes them.
      if (requestParameters.get('build') !== build) throw new Refusal('outdated');
      const access = await readAccess(db, socket.userId, documentName);
      if (!access) throw new Refusal('forbidden');
      connectionConfig.readOnly = access.readOnly;
      return { access };
    },

    async connected({ connection, documentName }) {
      if (contextOf(connection).access) sendAccess(connection);
      else if (!(await refreshAccess(connection, documentName))) {
        closeNow(connection, CloseCode.Forbidden);
      }
    },

    async onLoadDocument({ document, documentName }) {
      const state = await loadState(db, documentName);
      if (state && state.length > 0) Y.applyUpdate(document, state, MERGE_ORIGIN);
    },

    async afterLoadDocument({ document }) {
      sizes.set(document, pageSize(document, info));
    },

    async beforeHandleMessage({ connection, document, update }) {
      // Sockets refuse unreadable messages before this; refusing them here too fails closed.
      const head = readMessageHead(update);
      if (!head) throw closeRequest(connection, CloseCode.Forbidden);
      if (head.update) await checkChange(connection, document, head.update);
    },

    async beforeHandleAwareness(payload) {
      const extra = payload as unknown as {
        connection?: Connection | null;
        transactionOrigin?: unknown;
      };
      const connection = extra.connection ?? originConnection(extra.transactionOrigin);
      if (connection)
        stampAwareness(connection, payload.document, payload.states, payload.removedClients);
    },

    async onStoreDocument({ document, documentName, lastContext }) {
      const by = (lastContext as Partial<CollabContext> | undefined)?.socket?.userId ?? null;
      const size = sizes.get(document);
      const copies = await store(documentName, document, by);
      if (!copies) return;
      // Changes accepted while saving raised the size; it stays an upper bound then.
      if (size && sizes.get(document) === size) {
        sizes.set(document, { ...size, blocks: copies.blockCount });
      }
      events.emit('page.updated', { pageId: documentName, by, content: true, source: 'collab' });
    },
  });
  setLiveDocs((pageId) => hocuspocus.documents.get(pageId));

  /** Saves the page, without its last editor if their account is gone. Null if the page is gone. */
  async function store(pageId: string, doc: Y.Doc, by: string | null) {
    for (const author of by ? [by, null] : [null]) {
      try {
        return await saveDoc(db, pageId, doc, author);
      } catch (error) {
        if (!isMissingRow(error)) throw error;
      }
    }
    return null;
  }

  /**
   * Refuses changes from read-only connections, unsafe content, pages past the limits and
   * changes written under another person's client ID.
   */
  async function checkChange(connection: Connection, document: LiveDocument, update: Uint8Array) {
    const context = contextOf(connection);
    if (!context.access || Date.now() - context.access.checkedAt > RECHECK_MS) {
      if (!(await refreshAccess(connection, document.name))) {
        throw closeRequest(connection, CloseCode.Forbidden);
      }
    }
    if (context.access?.readOnly) {
      // A sync step with nothing new in it is fine; any real change closes the connection.
      if (changesNothing(document, update)) return;
      throw closeRequest(connection, CloseCode.Forbidden);
    }
    const result = checkUpdate(update, document, info, sizes.get(document));
    if (!result.ok) {
      if (result.tooLong) throw closeRequest(connection, CloseCode.TooLong);
      throw refusal(connection, document, result.reason);
    }
    const problem = clientProblem(connection, document, update);
    if (problem) throw refusal(connection, document, problem);
    sizes.set(document, result.size);
  }

  function refusal(connection: Connection, document: LiveDocument, reason: string): CloseRequest {
    const { userId } = contextOf(connection).socket;
    app.log.warn({ pageId: document.name, userId, reason }, 'collab: refused a change');
    return closeRequest(connection, CloseCode.Forbidden);
  }

  /**
   * Yjs trusts client IDs: someone writing under another person's ID could take the place of
   * that person's next edits. An ID that another person's open connection uses for its presence
   * is theirs, so new changes under it from anyone else are refused.
   */
  function clientProblem(connection: Connection, document: LiveDocument, update: Uint8Array) {
    const taken = othersClients(connection, document);
    if (taken.size === 0) return null;
    for (const [client, end] of Y.parseUpdateMeta(update).to) {
      if (taken.has(client) && end > Y.getState(document.store, client)) {
        return 'client ID of another person';
      }
    }
    return null;
  }

  /** The client IDs other people's open connections to the page use for their presence. */
  function othersClients(connection: Connection, document: LiveDocument): Set<number> {
    const { userId } = contextOf(connection).socket;
    const taken = new Set<number>();
    for (const other of document.getConnections()) {
      if (contextOf(other).socket.userId === userId) continue;
      for (const id of document.getClients(other)) taken.add(id);
    }
    return taken;
  }

  /** Reads the person's access again; false if it's gone. */
  async function refreshAccess(connection: Connection, pageId: string): Promise<boolean> {
    const access = await readAccess(db, contextOf(connection).socket.userId, pageId);
    if (access) applyAccess(connection, access);
    return access !== null;
  }

  function applyAccess(connection: Connection, access: PageAccess): void {
    const context = contextOf(connection);
    const before = context.access;
    context.access = access;
    connection.readOnly = access.readOnly;
    if (
      !before ||
      before.readOnly !== access.readOnly ||
      before.level !== access.level ||
      before.reason !== access.reason
    ) {
      sendAccess(connection);
    }
  }

  function sendAccess(connection: Connection): void {
    const access = contextOf(connection).access;
    if (!access) return;
    const { level, readOnly, reason } = access;
    connection.sendStateless(
      JSON.stringify({ type: 'carehub.access', build, level, readOnly, reason }),
    );
  }

  /**
   * A client may only change or remove its own presence, never under a client ID another
   * person uses, and always shows its real name.
   */
  function stampAwareness(
    connection: Connection,
    document: LiveDocument,
    states: Map<number, Record<string, unknown>>,
    removed: Set<number>,
  ): void {
    const owned = document.getClients(connection);
    const taken = othersClients(connection, document);
    for (const id of removed) if (!owned.has(id)) removed.delete(id);
    let newClients = 0;
    for (const [id, state] of states) {
      const isNew = !owned.has(id);
      if (
        taken.has(id) ||
        !isRecord(state) ||
        (isNew && owned.size + ++newClients > MAX_CLIENTS_PER_CONNECTION) ||
        JSON.stringify(state).length > MAX_AWARENESS_BYTES
      ) {
        states.delete(id);
      } else {
        state.user = contextOf(connection).presence;
      }
    }
  }

  function closeSocket(socket: Socket, code: number): void {
    setTimeout(() => socket.ws.close(code, CLOSE_REASONS[code]), 50).unref();
  }

  /** Hocuspocus closes the page connection on this; the socket closes with `code` right after. */
  function closeRequest(connection: Connection, code: number): CloseRequest {
    closeSocket(contextOf(connection).socket, code);
    return new CloseRequest(code, CLOSE_REASONS[code] ?? 'closed');
  }

  function closeNow(connection: Connection, code: number): void {
    connection.close({ code, reason: CLOSE_REASONS[code] ?? 'closed' });
    closeSocket(contextOf(connection).socket, code);
  }

  /** After access events (and every 30 s): switch open pages to read-only, or close them. */
  async function recheckAll(withSessions: boolean): Promise<void> {
    try {
      if (withSessions) {
        for (const socket of sockets) {
          const user = await getUserFromSessionToken(db, socket.token);
          if (!user) closeSocket(socket, CloseCode.SignedOut);
        }
      }
      for (const [pageId, document] of hocuspocus.documents) {
        for (const connection of document.getConnections()) {
          if (!(await refreshAccess(connection, pageId))) closeNow(connection, CloseCode.Forbidden);
        }
      }
    } catch (error) {
      app.log.error({ err: error }, 'collab: access check failed');
    }
  }

  let recheckTimer: NodeJS.Timeout | undefined;
  const scheduleRecheck = () => {
    recheckTimer ??= setTimeout(() => {
      recheckTimer = undefined;
      void recheckAll(false);
    }, 300);
  };
  const unsubscribe = ACCESS_EVENTS.map((name) => events.on(name, scheduleRecheck));
  unsubscribe.push(
    events.on('page.updated', (payload) => {
      const { pageId, source } = (payload ?? {}) as { pageId?: unknown; source?: unknown };
      if (source === 'collab') return;
      if (typeof pageId === 'string') {
        mergeStored(db, pageId)
          .then(() => {
            // What another feature wrote isn't in the page's size yet: measure it again.
            const document = hocuspocus.documents.get(pageId);
            if (document) sizes.set(document, pageSize(document, info));
          })
          .catch((error: unknown) => app.log.error({ err: error, pageId }, 'collab: merge failed'));
      }
      scheduleRecheck(); // the page may have been locked or unlocked
    }),
  );
  const sweep = setInterval(() => void recheckAll(true), SWEEP_MS);
  sweep.unref();

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  app.server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== path) {
      if (app.server.listenerCount('upgrade') === 1) socket.destroy();
      return;
    }
    upgrade(request, socket, head, url).catch((error: unknown) => {
      app.log.error({ err: error }, 'collab: upgrade failed');
      refuseUpgrade(socket, 500);
    });
  });

  async function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer, url: URL) {
    if (!isSameOrigin(request, publicUrl)) return refuseUpgrade(socket, 403);
    const token = readCookie(request.headers.cookie, sessionCookieName(app));
    const user = token ? await getUserFromSessionToken(db, token) : null;
    if (!token || !user) return refuseUpgrade(socket, 401);
    if ((socketsPerUser.get(user.id) ?? 0) >= MAX_SOCKETS_PER_USER) {
      return refuseUpgrade(socket, 429);
    }
    const presence = presenceOf(user);
    wss.handleUpgrade(request, socket, head, (ws) => {
      attach({ ws, token, userId: user.id }, presence, url);
    });
  }

  function attach(socket: Socket, presence: Presence, url: URL): void {
    const { ws, userId } = socket;
    sockets.add(socket);
    socketsPerUser.set(userId, (socketsPerUser.get(userId) ?? 0) + 1);
    const context: CollabContext = { socket, presence };
    const client = hocuspocus.handleConnection(ws, new Request(url), context);
    const ping = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.ping();
    }, PING_MS);
    const messages = tokenBucket(MESSAGES_PER_SECOND, MESSAGE_BURST);
    const bytes = tokenBucket(BYTES_PER_SECOND, BYTE_BURST);
    let refused = false;
    ws.on('message', (data: RawData) => {
      if (refused) return;
      const message = toBytes(data);
      // Fail closed: what this server can't read never reaches Hocuspocus.
      const code =
        !messages(1) || !bytes(message.length)
          ? CloseCode.TooFast
          : readMessageHead(message)
            ? null
            : CloseCode.Forbidden;
      if (code !== null) {
        refused = true;
        ws.close(code, CLOSE_REASONS[code]);
        return;
      }
      // Called from an async function, anything Hocuspocus throws is logged, not a crash.
      (async () => client.handleMessage(message))().catch((error: unknown) =>
        app.log.error({ err: error }, 'collab: message failed'),
      );
    });
    ws.on('pong', () => client.touch());
    ws.on('error', () => ws.terminate());
    ws.once('close', (code: number, reason: Buffer) => {
      clearInterval(ping);
      sockets.delete(socket);
      const left = (socketsPerUser.get(userId) ?? 1) - 1;
      if (left > 0) socketsPerUser.set(userId, left);
      else socketsPerUser.delete(userId);
      client.handleClose({ code, reason: reason.toString() });
    });
  }

  // WebSockets would keep the HTTP server from closing, so they go before it does.
  app.addHook('preClose', async () => {
    for (const stop of unsubscribe) stop();
    clearInterval(sweep);
    clearTimeout(recheckTimer);
    hocuspocus.closeConnections();
    // Each page is stored as its last connection leaves; give that a moment.
    for (let waited = 0; hocuspocus.getDocumentsCount() > 0 && waited < 3_000; waited += 50) {
      await sleep(50);
    }
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    setLiveDocs(() => undefined);
  });
}

async function readAccess(db: Db, userId: string, pageId: string): Promise<PageAccess | null> {
  const [level, page] = await Promise.all([
    getPageAccess(db, userId, pageId),
    getPageState(db, pageId),
  ]);
  if (!page || !atLeast(level, 'view')) return null;
  const reason: ReadOnlyReason | null = page.trashed
    ? 'trashed'
    : page.locked
      ? 'locked'
      : atLeast(level, 'edit')
        ? null
        : 'access';
  return { level, readOnly: reason !== null, reason, checkedAt: Date.now() };
}

/**
 * The session cookie's name. The auth PR (#55) adds `app.sessionCookies.names` (with the
 * `__Host-` prefix on HTTPS); until it lands the name is SESSION_COOKIE.
 */
function sessionCookieName(app: FastifyInstance): string {
  const cookies = app.sessionCookies as unknown as { names?: { session?: unknown } } | undefined;
  const name = cookies?.names?.session;
  return typeof name === 'string' ? name : SESSION_COOKIE;
}

function presenceOf(user: { id: string; name: string; avatarUrl?: string | null }): Presence {
  let hash = 0;
  for (const char of user.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const fullName = user.name.trim();
  return {
    id: user.id,
    name: fullName.split(/\s+/)[0] ?? fullName,
    fullName,
    avatarUrl: user.avatarUrl ?? null,
    color: PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? 'blue',
  };
}

function originConnection(origin: unknown): Connection | null {
  const value = origin as { source?: unknown; connection?: Connection } | null | undefined;
  return value?.source === 'connection' && value.connection ? value.connection : null;
}

/** Browsers send Origin with every WebSocket; another site's page must not reach this socket. */
function isSameOrigin(request: IncomingMessage, publicUrl: string | undefined): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    if (publicUrl) return new URL(publicUrl).origin === new URL(origin).origin;
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function readCookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function refuseUpgrade(socket: Duplex, status: number): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.once('finish', () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/**
 * The message in a buffer of its own. A ws Buffer may share memory with other data, and lib0
 * reads a byte array by its stated length: past the end it must fail, not read that data.
 */
function toBytes(data: RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(Array.isArray(data) ? Buffer.concat(data) : data);
}

/** Allows `perSecond` on average and `burst` at once; a take that goes over returns false. */
function tokenBucket(perSecond: number, burst: number): (amount: number) => boolean {
  let tokens = burst;
  let last = performance.now();
  return (amount) => {
    const now = performance.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1_000) * perSecond);
    last = now;
    if (amount > tokens) return false;
    tokens -= amount;
    return true;
  };
}

function changesNothing(doc: Y.Doc, update: Uint8Array): boolean {
  try {
    return Y.snapshotContainsUpdate(Y.snapshot(doc), update);
  } catch {
    return false;
  }
}

/** Postgres foreign-key violation: the page (or the person) no longer exists. */
function isMissingRow(error: unknown): boolean {
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return value?.code === '23503' || value?.cause?.code === '23503';
}
