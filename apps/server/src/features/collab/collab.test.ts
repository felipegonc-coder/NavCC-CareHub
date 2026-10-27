import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import * as decoding from 'lib0/decoding';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createTestApp, createUser, hasDatabase } from '../../testing';
import { getPageText } from './index';
import { MessageType, SyncStep } from './protocol';
import { CloseCode } from './server';
import { pageFragment, readContent } from './ydoc';

// Sessions and page access are stand-ins here: this file tests the collab server, not them.
const sessions = vi.hoisted(() => new Map<string, unknown>());
const levels = vi.hoisted(() => new Map<string, string>());
const states = vi.hoisted(() => new Map<string, { trashed: boolean; locked: boolean }>());

vi.mock('../auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getUserFromSessionToken: async (_db: unknown, token: string) => sessions.get(token) ?? null,
}));

vi.mock('./page-access', () => ({
  getPageAccess: async (_db: unknown, userId: string, pageId: string) =>
    levels.get(`${userId}:${pageId}`) ?? 'none',
  getPageState: async (_db: unknown, pageId: string) =>
    states.get(pageId) ?? { trashed: false, locked: false },
}));

type TestApp = Awaited<ReturnType<typeof createTestApp>>;

const BUILD = '1.2.3-test';
const pageId = randomUUID();

let test: TestApp;
let port = 0;
const people: Record<string, { id: string }> = {};

const AUTH_TOKEN = 0;
const PERMISSION_DENIED = 1;
/** Zero as a var-uint in nine bytes. lib0 (so Hocuspocus too) reads it as 0. */
const OVERLONG_ZERO = Uint8Array.from([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00]);
let presenceClock = 0;

/** lib0 encoding: numbers as var-uints, strings and bytes with their length first. */
function encode(...parts: Array<number | string | Uint8Array>): Uint8Array {
  const out: number[] = [];
  const uint = (value: number) => {
    while (value > 0x7f) {
      out.push((value & 0x7f) | 0x80);
      value = Math.floor(value / 128);
    }
    out.push(value);
  };
  for (const part of parts) {
    if (typeof part === 'number') {
      uint(part);
      continue;
    }
    const bytes = typeof part === 'string' ? new TextEncoder().encode(part) : part;
    uint(bytes.length);
    for (const byte of bytes) out.push(byte);
  }
  return Uint8Array.from(out);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

function openSocket(token: string | null, options: { build?: string; origin?: string } = {}) {
  const build = encodeURIComponent(options.build ?? BUILD);
  const headers: Record<string, string> = { Origin: options.origin ?? `http://127.0.0.1:${port}` };
  if (token) headers.Cookie = `${test.app.sessionCookies.names.session}=${token}`;
  return new WebSocket(`ws://127.0.0.1:${port}/api/collab?build=${build}`, { headers });
}

/** A hand-made client: it speaks the protocol directly, so it can send what an editor never would. */
class TestClient {
  readonly doc = new Y.Doc();
  access: Record<string, unknown> | null = null;
  denied: string | null = null;
  closeCode: number | null = null;
  synced = false;
  /** Presence by client ID, as the server sent it. */
  readonly presence = new Map<number, Record<string, unknown>>();

  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data: Buffer) => this.receive(new Uint8Array(data)));
    ws.on('close', (code: number) => {
      this.closeCode = code;
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== this) this.send(MessageType.Sync, SyncStep.Update, update);
    });
  }

  static async connect(
    token: string,
    options: { build?: string; clientID?: number } = {},
  ): Promise<TestClient> {
    const ws = openSocket(token, { build: options.build });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const client = new TestClient(ws);
    if (options.clientID !== undefined) client.doc.clientID = options.clientID;
    client.send(MessageType.Auth, AUTH_TOKEN, 'session-cookie');
    client.send(MessageType.Sync, SyncStep.One, Y.encodeStateVector(client.doc));
    return client;
  }

  send(...parts: Array<number | string | Uint8Array>): void {
    this.sendRaw(encode(pageId, ...parts));
  }

  sendRaw(message: Uint8Array): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(message);
  }

  /** An awareness update for one client: count, client ID, clock, state as JSON. */
  setPresence(state: Record<string, unknown>, clientID = this.doc.clientID): void {
    presenceClock += 1;
    this.send(MessageType.Awareness, encode(1, clientID, presenceClock, JSON.stringify(state)));
  }

  edit(change: (fragment: Y.XmlFragment) => void): void {
    this.doc.transact(() => change(pageFragment(this.doc)));
  }

  text(): string {
    return JSON.stringify(readContent(this.doc));
  }

  close(): void {
    this.ws.close();
  }

  private receive(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    decoding.readVarString(decoder);
    const type = decoding.readVarUint(decoder);
    if (type === MessageType.Auth) {
      if (decoding.readVarUint(decoder) === PERMISSION_DENIED) {
        this.denied = decoding.readVarString(decoder);
      }
    } else if (type === MessageType.Sync || type === MessageType.SyncReply) {
      const step = decoding.readVarUint(decoder);
      const payload = decoding.readVarUint8Array(decoder);
      if (step === SyncStep.One) {
        this.send(MessageType.Sync, SyncStep.Two, Y.encodeStateAsUpdate(this.doc, payload));
      } else {
        Y.applyUpdate(this.doc, payload, this);
        if (step === SyncStep.Two) this.synced = true;
      }
    } else if (type === MessageType.Awareness) {
      const update = decoding.createDecoder(decoding.readVarUint8Array(decoder));
      for (let count = decoding.readVarUint(update); count > 0; count -= 1) {
        const id = decoding.readVarUint(update);
        decoding.readVarUint(update); // clock
        const state = JSON.parse(decoding.readVarString(update)) as Record<string, unknown> | null;
        if (state) this.presence.set(id, state);
        else this.presence.delete(id);
      }
    } else if (type === MessageType.Stateless) {
      this.access = JSON.parse(decoding.readVarString(decoder)) as Record<string, unknown>;
    }
  }
}

function paragraph(text: string, attributes: Record<string, unknown> = {}): Y.XmlElement {
  const run = new Y.XmlText();
  run.applyDelta([{ insert: text, attributes }]);
  const element = new Y.XmlElement('paragraph');
  element.insert(0, [run]);
  return element;
}

/** The update that adds `block` at the top of a copy of `doc`; `doc` itself doesn't change. */
function updateAdding(doc: Y.Doc, block: Y.XmlElement): Uint8Array {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
  const before = Y.encodeStateVector(copy);
  pageFragment(copy).insert(0, [block]);
  return Y.encodeStateAsUpdate(copy, before);
}

async function waitFor(check: () => boolean | Promise<boolean>, timeout = 8_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await sleep(25);
  }
}

function emit(name: string, payload: object): void {
  (test.app.events as unknown as { emit(name: string, payload: object): void }).emit(name, payload);
}

async function storedText(): Promise<string> {
  const { rows } = await test.db.execute(sql`select text from page_docs where page_id = ${pageId}`);
  return String(rows[0]?.text ?? '');
}

/** The HTTP status of an upgrade request (101 when the socket opens). */
function upgradeStatus(token: string | null, origin?: string): Promise<number> {
  const ws = openSocket(token, { origin });
  return new Promise((resolve) => {
    ws.once('unexpected-response', (request, response) => {
      resolve(response.statusCode ?? 0);
      request.destroy();
    });
    ws.once('open', () => {
      resolve(101);
      ws.close();
    });
    ws.on('error', () => undefined);
  });
}

// The server needs Postgres (CI provides DATABASE_URL).
beforeAll(async () => {
  if (!hasDatabase) return;
  test = await createTestApp({ env: { CAREHUB_VERSION: BUILD } });
  await test.app.listen({ port: 0, host: '127.0.0.1' });
  port = (test.app.server.address() as AddressInfo).port;
  const accounts = {
    owner: await createUser(test.db, { name: 'Robin Example' }),
    teammate: await createUser(test.db, { name: 'Sam Sample' }),
    viewer: await createUser(test.db, { name: 'Vic Viewer' }),
    outsider: await createUser(test.db, { name: 'Oli Outside' }),
  };
  for (const [key, user] of Object.entries(accounts)) {
    people[key] = user;
    sessions.set(`${key}-token`, user);
  }
  levels.set(`${accounts.owner.id}:${pageId}`, 'full');
  levels.set(`${accounts.teammate.id}:${pageId}`, 'edit');
  levels.set(`${accounts.viewer.id}:${pageId}`, 'view');
});

afterAll(async () => {
  await test?.close();
});

describe.skipIf(!hasDatabase)('live co-editing', { timeout: 30_000 }, () => {
  it('shares changes between editors and stores them', async () => {
    const owner = await TestClient.connect('owner-token');
    const teammate = await TestClient.connect('teammate-token');
    await waitFor(() => owner.synced && teammate.synced && owner.access !== null);
    expect(owner.access).toEqual({
      type: 'carehub.access',
      build: BUILD,
      level: 'full',
      readOnly: false,
      reason: null,
    });
    owner.edit((fragment) => fragment.insert(0, [paragraph('Refunds go out on Fridays')]));
    await waitFor(() => teammate.text().includes('Refunds go out on Fridays'));
    owner.close();
    teammate.close();
    await waitFor(async () => (await storedText()).includes('Refunds go out on Fridays'));
    expect(await getPageText(test.db, pageId)).toContain('Refunds go out on Fridays');
  });

  it('refuses a javascript: link, and the other editor never receives it', async () => {
    const attacker = await TestClient.connect('teammate-token');
    const owner = await TestClient.connect('owner-token');
    await waitFor(() => attacker.synced && owner.synced);
    attacker.edit((fragment) => {
      fragment.insert(0, [paragraph('Open me', { link: { href: 'javascript:alert(1)' } })]);
    });
    await waitFor(() => attacker.closeCode !== null);
    expect(attacker.closeCode).toBe(CloseCode.Forbidden);
    await sleep(300);
    expect(owner.text()).not.toContain('javascript:');
    expect(owner.text()).not.toContain('Open me');
    owner.close();
  });

  it('refuses any message it can’t read, and messages only servers send', async () => {
    const owner = await TestClient.connect('owner-token');
    await waitFor(() => owner.synced);
    const link = { link: { href: 'javascript:alert(1)' } };
    const update = updateAdding(owner.doc, paragraph('Open me', link));
    const messages = [
      // Type 0 in nine bytes: Hocuspocus reads a sync message, so the check must read one too.
      concat(encode(pageId), OVERLONG_ZERO, encode(SyncStep.Update, update)),
      // An update shorter than its stated length.
      concat(encode(pageId, MessageType.Sync, SyncStep.Update), Uint8Array.from([100, 1, 2])),
      encode(pageId, MessageType.BroadcastStateless, '{"type":"carehub.access"}'),
      encode(pageId, 99),
      new Uint8Array(0),
    ];
    for (const message of messages) {
      const attacker = await TestClient.connect('teammate-token');
      await waitFor(() => attacker.synced);
      attacker.sendRaw(message);
      await waitFor(() => attacker.closeCode !== null);
      expect(attacker.closeCode).toBe(CloseCode.Forbidden);
    }
    await sleep(300);
    expect(owner.text()).not.toContain('Open me');
    owner.close();
  });

  it('refuses changes under a client ID another person uses', async () => {
    const owner = await TestClient.connect('owner-token');
    await waitFor(() => owner.synced);
    owner.setPresence({ cursor: null });
    const id = owner.doc.clientID;
    const forger = await TestClient.connect('teammate-token', { clientID: id });
    await waitFor(() => forger.synced && forger.presence.has(id));
    forger.edit((fragment) => fragment.insert(0, [paragraph('Written as Robin')]));
    await waitFor(() => forger.closeCode !== null);
    expect(forger.closeCode).toBe(CloseCode.Forbidden);
    await sleep(300);
    expect(owner.text()).not.toContain('Written as Robin');
    owner.close();
  });

  it('shows the real name in presence, which only its own client can change', async () => {
    const teammate = await TestClient.connect('teammate-token');
    const owner = await TestClient.connect('owner-token');
    await waitFor(() => teammate.synced && owner.synced);
    const id = teammate.doc.clientID;
    teammate.setPresence({ user: { name: 'Robin Example', color: 'red' }, cursor: null });
    await waitFor(() => owner.presence.has(id));
    expect(owner.presence.get(id)).toMatchObject({
      user: { id: people.teammate?.id, name: 'Sam', fullName: 'Sam Sample' },
      cursor: null,
    });
    // Everyone gets every presence change, the sender too: this one never comes.
    owner.setPresence({ cursor: { anchor: 1 } }, id);
    await sleep(300);
    expect(owner.presence.get(id)).toMatchObject({ user: { name: 'Sam' }, cursor: null });
    teammate.close();
    owner.close();
  });

  it('closes sockets that send too much or too fast', async () => {
    const large = await TestClient.connect('owner-token');
    await waitFor(() => large.synced);
    large.sendRaw(new Uint8Array(5 * 1024 * 1024));
    await waitFor(() => large.closeCode !== null);
    expect(large.closeCode).toBe(1009); // ws: message too big
    const fast = await TestClient.connect('owner-token');
    await waitFor(() => fast.synced);
    for (let sent = 0; sent < 400; sent += 1) fast.send(MessageType.QueryAwareness);
    await waitFor(() => fast.closeCode !== null);
    expect(fast.closeCode).toBe(CloseCode.TooFast);
  });

  it('keeps viewers read-only and closes their connection on any change', async () => {
    const viewer = await TestClient.connect('viewer-token');
    await waitFor(() => viewer.synced && viewer.access !== null);
    expect(viewer.access).toMatchObject({ level: 'view', readOnly: true, reason: 'access' });
    expect(viewer.text()).toContain('Refunds go out on Fridays');
    viewer.edit((fragment) => fragment.insert(0, [paragraph('Viewer was here')]));
    await waitFor(() => viewer.closeCode !== null);
    expect(viewer.closeCode).toBe(CloseCode.Forbidden);
    expect(await getPageText(test.db, pageId)).not.toContain('Viewer was here');
  });

  it('turns editing off when access drops, and closes when access is gone', async () => {
    const key = `${people.teammate?.id}:${pageId}`;
    const teammate = await TestClient.connect('teammate-token');
    await waitFor(() => teammate.access?.readOnly === false);
    levels.set(key, 'view');
    emit('access.changed', { pageId });
    await waitFor(() => teammate.access?.readOnly === true);
    levels.set(key, 'none');
    emit('access.changed', { pageId });
    await waitFor(() => teammate.closeCode !== null);
    expect(teammate.closeCode).toBe(CloseCode.Forbidden);
    levels.set(key, 'edit');
  });

  it('turns editing off while the page is in the trash', async () => {
    const owner = await TestClient.connect('owner-token');
    await waitFor(() => owner.access?.readOnly === false);
    states.set(pageId, { trashed: true, locked: false });
    emit('page.trashed', { pageId });
    await waitFor(() => owner.access?.readOnly === true);
    expect(owner.access).toMatchObject({ level: 'full', reason: 'trashed' });
    states.delete(pageId);
    emit('page.restored', { pageId });
    await waitFor(() => owner.access?.readOnly === false);
    owner.close();
  });

  it('stops a tab from another build before it loads anything', async () => {
    const old = await TestClient.connect('owner-token', { build: 'an-older-build' });
    await waitFor(() => old.denied !== null);
    expect(old.denied).toBe('outdated');
    expect(readContent(old.doc)).toEqual([]);
    old.close();
  });

  it('refuses people without access to the page', async () => {
    const outsider = await TestClient.connect('outsider-token');
    await waitFor(() => outsider.denied !== null);
    expect(outsider.denied).toBe('forbidden');
    expect(readContent(outsider.doc)).toEqual([]);
    outsider.close();
  });

  it('needs a session and the app’s own origin', async () => {
    expect(await upgradeStatus(null)).toBe(401);
    expect(await upgradeStatus('owner-token', 'https://elsewhere.example')).toBe(403);
    expect(await upgradeStatus('owner-token')).toBe(101);
  });
});
