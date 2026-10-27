import { STATUS_CODES, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { atLeast, type AccessLevel } from '@carehub/shared';
import { Hocuspocus, type Connection, type Document as LiveDocument } from '@hocuspocus/server';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import * as Y from 'yjs';
import type { Db } from '../../db';
import { SESSION_COOKIE, getUserFromSessionToken } from '../auth';
import { getPageAccess } from '../pages';
import { checkUpdate, pageSchemaInfo } from './check';
import { MessageType, readMessageHead } from './protocol';
import { MAX_BLOCKS, MERGE_ORIGIN, loadState, mergeStored, saveDoc, setLiveDocs } from './store';
import { countBlocks, isRecord } from './ydoc';

const PING_MS = 2_000;
/** Hocuspocus drops a socket that sends nothing, not even a pong, for this long. */
const TIMEOUT_MS = 6_000;
/** Before a change, access is checked again if the last check is older than this. */
const RECHECK_MS = 1_000;
const SWEEP_MS = 30_000;
const MAX_MESSAGE_BYTES = 16 * 1024 * 1024;
const MAX_SOCKETS_PER_USER = 20;
const MAX_CLIENTS_PER_CONNECTION = 8;
const MAX_AWARENESS_BYTES = 8 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Caret and avatar colours, picked from the user ID so a person looks the same everywhere. */
const PRESENCE_COLORS = [
  '#2563EB',
  '#DB2777',
  '#059669',
  '#D97706',
  '#7C3AED',
  '#DC2626',
  '#0891B2',
  '#4D7C0F',
];
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
export const CloseCode = { SignedOut: 4401, Forbidden: 4403, TooLong: 4413 } as const;

const CLOSE_REASONS: Record<number, string> = {
  [CloseCode.SignedOut]: 'signed-out',
  [CloseCode.Forbidden]: 'forbidden',
  [CloseCode.TooLong]: 'too-long',
};

/** The build clients must match to edit; a tab from an older build reloads first. */
export function serverBuild(): string {
  return process.env.CAREHUB_VERSION || '0.0.0-dev';
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
  on(name: string, handler: (payload: unknown) => void): void;
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

export function startCollabServer(app: FastifyInstance, path: string): void {
  const db = app.db;
  const events = app.events as unknown as Events;
  const build = serverBuild();
  const info = pageSchemaInfo();
  const estimates = new WeakMap<Y.Doc, number>();
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
      estimates.set(document, countBlocks(document, info.inline));
    },

    async beforeHandleMessage({ connection, document, update }) {
      const head = readMessageHead(update);
      // Only the server speaks to every editor of a page; a client could forge access messages.
      if (head?.type === MessageType.BroadcastStateless) {
        throw closeRequest(connection, CloseCode.Forbidden);
      }
      if (head?.update) await checkChange(connection, document, head.update);
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
      let blockCount: number;
      try {
        ({ blockCount } = await saveDoc(db, documentName, document, by));
      } catch (error) {
        if (isMissingRow(error)) return; // the page was deleted while open
        throw error;
      }
      estimates.set(document, blockCount);
      events.emit('page.updated', { pageId: documentName, by, content: true, source: 'collab' });
    },
  });
  setLiveDocs((pageId) => hocuspocus.documents.get(pageId));

  /** Refuses changes from read-only connections, unsafe content and pages past the limit. */
  async function checkChange(connection: Connection, document: LiveDocument, update: Uint8Array) {
    const context = contextOf(connection);
    if (!context.access || Date.now() - context.access.checkedAt > RECHECK_MS) {
      if (!(await refreshAccess(connection, document.name))) {
        throw closeRequest(connection, CloseCode.Forbidden);
      }
    }
    if (context.access?.readOnly) {
      // A sync step with nothing new in it is fine; any real change closes the connection.
      if (Y.snapshotContainsUpdate(Y.snapshot(document), update)) return;
      throw closeRequest(connection, CloseCode.Forbidden);
    }
    const result = checkUpdate(update, document, info);
    if (!result.ok) {
      app.log.warn(
        { pageId: document.name, userId: context.socket.userId, reason: result.reason },
        'collab: refused a change',
      );
      throw closeRequest(connection, CloseCode.Forbidden);
    }
    let estimate = (estimates.get(document) ?? 0) + result.blocks;
    if (estimate > MAX_BLOCKS) {
      estimate = blocksAfter(document, update);
      if (estimate > MAX_BLOCKS) throw closeRequest(connection, CloseCode.TooLong);
    }
    estimates.set(document, estimate);
  }

  function blocksAfter(document: Y.Doc, update: Uint8Array): number {
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(document));
    Y.applyUpdate(scratch, update);
    const count = countBlocks(scratch, info.inline);
    scratch.destroy();
    return count;
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

  /** A client may only change or remove its own presence, and always shows its real name. */
  function stampAwareness(
    connection: Connection,
    document: LiveDocument,
    states: Map<number, Record<string, unknown>>,
    removed: Set<number>,
  ): void {
    const owned = document.getClients(connection);
    const taken = new Set<number>();
    for (const other of document.getConnections()) {
      if (other !== connection) for (const id of document.getClients(other)) taken.add(id);
    }
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
  for (const name of ACCESS_EVENTS) events.on(name, scheduleRecheck);
  events.on('page.updated', (payload) => {
    const { pageId, source } = (payload ?? {}) as { pageId?: unknown; source?: unknown };
    if (source === 'collab') return;
    if (typeof pageId === 'string') {
      mergeStored(db, pageId).catch((error: unknown) =>
        app.log.error({ err: error, pageId }, 'collab: merge failed'),
      );
    }
    scheduleRecheck(); // the page may have been locked or unlocked
  });
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
    if (!isSameOrigin(request)) return refuseUpgrade(socket, 403);
    const token = readCookie(request.headers.cookie, SESSION_COOKIE);
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
    ws.on('message', (data: RawData) => {
      Promise.resolve(client.handleMessage(toBytes(data))).catch((error: unknown) =>
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
  const level = await getPageAccess(db, userId, pageId);
  if (!atLeast(level, 'view')) return null;
  // Locking (PB-22) belongs to the page model; read it without depending on the column name yet.
  const { rows } = await db.execute(sql`
    select p.deleted_at is not null as trashed,
      coalesce(to_jsonb(p) ->> 'locked_at', nullif(to_jsonb(p) ->> 'locked', 'false')) is not null
        as locked
    from pages p
    where p.id = ${pageId}`);
  const page = rows[0] as { trashed?: boolean; locked?: boolean } | undefined;
  if (!page) return null;
  const reason: ReadOnlyReason | null = page.trashed
    ? 'trashed'
    : page.locked
      ? 'locked'
      : atLeast(level, 'edit')
        ? null
        : 'access';
  return { level, readOnly: reason !== null, reason, checkedAt: Date.now() };
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
    color: PRESENCE_COLORS[hash % PRESENCE_COLORS.length] ?? '#2563EB',
  };
}

function originConnection(origin: unknown): Connection | null {
  const value = origin as { source?: unknown; connection?: Connection } | null | undefined;
  return value?.source === 'connection' && value.connection ? value.connection : null;
}

/** Browsers send Origin with every WebSocket; another site's page must not reach this socket. */
function isSameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    const publicUrl = process.env.CAREHUB_PUBLIC_URL;
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

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/** Postgres foreign-key violation: the page (or the person) no longer exists. */
function isMissingRow(error: unknown): boolean {
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return value?.code === '23503' || value?.cause?.code === '23503';
}
