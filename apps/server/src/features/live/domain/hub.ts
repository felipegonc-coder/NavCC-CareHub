import { randomUUID } from 'node:crypto';
import { encodeEvent, sseFrame, TOPIC_PREFIX, topicPrefix, type LiveEvent } from './frames';

/** Decides whether a user may hear a topic. Checked on subscribe, on reconnect and every 10 minutes. */
export type CanSubscribe = (input: { userId: string; topic: string }) => Promise<boolean>;

/** Where a connection's frames go (the SSE response). */
export interface LiveSink {
  /** Writes one frame. False means the client is behind: the hub waits for `drained()`. */
  write(frame: string): boolean;
  end(): void;
}

export interface LiveConnection {
  readonly id: string;
  /** The sink can take more frames again. */
  drained(): void;
  /** The client went away. Safe to call more than once. */
  disconnect(): void;
}

export interface LiveLogger {
  warn(details: object, message: string): void;
}

export interface TopicResult {
  topic: string;
  ok: boolean;
}

export interface LiveHubOptions {
  maxConnectionsPerUser?: number;
  maxQueuedFrames?: number;
  maxQueuedBytes?: number;
  maxTopicsPerConnection?: number;
  heartbeatMs?: number;
  recheckMs?: number;
  checkTimeoutMs?: number;
  /** The `retry:` hint sent with `hello`. */
  retryMs?: number;
  now?: () => number;
  createId?: () => string;
  log?: LiveLogger;
}

export interface LiveHub {
  publishToUsers(userIds: readonly string[], event: LiveEvent): void;
  publishTopic(topic: string, event: LiveEvent): void;
  registerTopic(prefix: string, canSubscribe: CanSubscribe): void;
  /** Opens a connection; its first frame is `hello` with the connection id. */
  connect(userId: string, sink: LiveSink): LiveConnection;
  /** True while the user has at least one open connection (a tab) on this server. */
  hasOpenTabs(userId: string): boolean;
  /** Null when the connection is unknown or belongs to someone else. */
  updateTopics(input: {
    userId: string;
    connectionId: string;
    add?: readonly string[];
    remove?: readonly string[];
  }): Promise<{ results: TopicResult[] } | null>;
  /**
   * Checks every topic of this user's tabs again now (every user's when omitted), for example
   * after an access change. Revoked topics end with `unsubscribed`. Checks already in flight
   * are ignored, so an answer from before the change never counts.
   */
  recheckSubscriptions(userId?: string): Promise<void>;
  /** Heartbeat, slow-client check and due access re-checks. Runs on a timer; exposed for tests. */
  tick(): Promise<void>;
  /** Ends every stream (server shutdown). Clients reconnect on their own. */
  closeAll(): void;
  setLogger(log: LiveLogger): void;
  stats(): { connections: number; users: number; subscriptions: number };
}

interface Subscription {
  checkedAt: number;
  checking: boolean;
}

interface Conn {
  id: string;
  userId: string;
  sink: LiveSink;
  queue: string[];
  queuedBytes: number;
  /** When the sink last refused more data; null while it keeps up. */
  blockedAt: number | null;
  topics: Map<string, Subscription>;
  /** Topics whose access check is in flight, with a token so a later add or remove wins. */
  pending: Map<string, symbol>;
  /** Bumped by `recheckSubscriptions`; a check that started under an older epoch doesn't count. */
  epoch: number;
  closed: boolean;
}

/** An in-process hub of live connections: per-user streams plus access-checked topics. */
export function createLiveHub(options: LiveHubOptions = {}): LiveHub {
  const maxPerUser = options.maxConnectionsPerUser ?? 5;
  const maxFrames = options.maxQueuedFrames ?? 100;
  const maxBytes = options.maxQueuedBytes ?? 256 * 1024;
  const maxTopics = options.maxTopicsPerConnection ?? 100;
  const heartbeatMs = options.heartbeatMs ?? 25_000;
  const recheckMs = options.recheckMs ?? 10 * 60_000;
  const checkTimeoutMs = options.checkTimeoutMs ?? 5_000;
  const retryMs = options.retryMs ?? 3_000;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  let log: LiveLogger = options.log ?? { warn: () => {} };

  const conns = new Map<string, Conn>();
  const byUser = new Map<string, Conn[]>();
  const byTopic = new Map<string, Set<Conn>>();
  const owners = new Map<string, CanSubscribe>();
  let timer: ReturnType<typeof setInterval> | null = null;
  const ping = sseFrame('ping', '{}');
  const bye = sseFrame('bye', JSON.stringify({ reason: 'replaced' }));

  function send(conn: Conn, frame: string): void {
    if (conn.closed) return;
    if (conn.queue.length >= maxFrames || conn.queuedBytes + frame.length > maxBytes) {
      log.warn({ connectionId: conn.id, userId: conn.userId }, 'live: dropped a slow client');
      close(conn);
      return;
    }
    conn.queue.push(frame);
    conn.queuedBytes += frame.length;
    flush(conn);
  }

  function flush(conn: Conn): void {
    while (!conn.closed && conn.blockedAt === null) {
      const frame = conn.queue.shift();
      if (frame === undefined) return;
      conn.queuedBytes -= frame.length;
      try {
        if (!conn.sink.write(frame)) conn.blockedAt = now();
      } catch {
        close(conn);
      }
    }
  }

  function close(conn: Conn, farewell?: string): void {
    if (conn.closed) return;
    conn.closed = true;
    conns.delete(conn.id);
    const others = (byUser.get(conn.userId) ?? []).filter((other) => other !== conn);
    if (others.length > 0) byUser.set(conn.userId, others);
    else byUser.delete(conn.userId);
    for (const topic of conn.topics.keys()) unindex(conn, topic);
    conn.topics.clear();
    conn.pending.clear();
    conn.queue = [];
    try {
      if (farewell) conn.sink.write(farewell);
      conn.sink.end();
    } catch {
      // The stream is already gone.
    }
    if (conns.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function unindex(conn: Conn, topic: string): void {
    const subscribers = byTopic.get(topic);
    subscribers?.delete(conn);
    if (subscribers?.size === 0) byTopic.delete(topic);
  }

  function subscribe(conn: Conn, topic: string): void {
    conn.topics.set(topic, { checkedAt: now(), checking: false });
    const subscribers = byTopic.get(topic) ?? new Set<Conn>();
    subscribers.add(conn);
    byTopic.set(topic, subscribers);
  }

  function unsubscribe(conn: Conn, topic: string): void {
    conn.pending.delete(topic);
    if (conn.topics.delete(topic)) unindex(conn, topic);
  }

  /** Asks the topic's owner. Unknown prefixes, errors and slow answers count as no. */
  async function check(userId: string, topic: string): Promise<boolean> {
    const prefix = topicPrefix(topic);
    const canSubscribe = prefix === null ? undefined : owners.get(prefix);
    if (!canSubscribe) return false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const expired = new Promise<'timeout'>((resolve) => {
        timeout = setTimeout(() => resolve('timeout'), checkTimeoutMs);
      });
      const answer = await Promise.race([canSubscribe({ userId, topic }), expired]);
      if (answer === 'timeout') log.warn({ topic }, 'live: topic access check timed out');
      return answer === true;
    } catch (error) {
      log.warn({ err: error, topic }, 'live: topic access check failed');
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function recheck(conn: Conn, topic: string, sub: Subscription): Promise<void> {
    const epoch = conn.epoch;
    sub.checking = true;
    const allowed = await check(conn.userId, topic);
    // Access changed while asking: the check started by `recheckSubscriptions` decides.
    if (conn.epoch !== epoch) return;
    sub.checking = false;
    if (conn.closed || conn.topics.get(topic) !== sub) return;
    if (allowed) {
      sub.checkedAt = now();
      return;
    }
    unsubscribe(conn, topic);
    send(conn, sseFrame('unsubscribed', JSON.stringify({ topic })));
  }

  async function tick(): Promise<void> {
    const at = now();
    const rechecks: Promise<void>[] = [];
    for (const conn of [...conns.values()]) {
      if (conn.blockedAt !== null && at - conn.blockedAt >= 2 * heartbeatMs) {
        log.warn({ connectionId: conn.id, userId: conn.userId }, 'live: dropped a stalled client');
        close(conn);
        continue;
      }
      if (conn.blockedAt === null) send(conn, ping);
      for (const [topic, sub] of conn.topics) {
        const due = at - sub.checkedAt >= recheckMs;
        if (due && !sub.checking) rechecks.push(recheck(conn, topic, sub));
      }
    }
    await Promise.all(rechecks);
  }

  return {
    publishToUsers(userIds, event) {
      const encoded = encodeEvent(event);
      if ('error' in encoded) {
        log.warn({ type: event?.type, reason: encoded.error }, 'live: event not sent');
        return;
      }
      for (const userId of new Set(userIds)) {
        for (const conn of byUser.get(userId) ?? []) send(conn, encoded.frame);
      }
    },

    publishTopic(topic, event) {
      const encoded = encodeEvent(event, topic);
      if ('error' in encoded) {
        log.warn({ topic, type: event?.type, reason: encoded.error }, 'live: event not sent');
        return;
      }
      for (const conn of [...(byTopic.get(topic) ?? [])]) send(conn, encoded.frame);
    },

    registerTopic(prefix, canSubscribe) {
      const name = prefix.endsWith(':') ? prefix.slice(0, -1) : prefix;
      if (!TOPIC_PREFIX.test(name)) throw new TypeError(`Invalid live topic prefix: ${prefix}`);
      owners.set(name, canSubscribe);
    },

    connect(userId, sink) {
      const conn: Conn = {
        id: createId(),
        userId,
        sink,
        queue: [],
        queuedBytes: 0,
        blockedAt: null,
        topics: new Map(),
        pending: new Map(),
        epoch: 0,
        closed: false,
      };
      conns.set(conn.id, conn);
      const mine = [...(byUser.get(userId) ?? []), conn];
      byUser.set(userId, mine);
      const hello = JSON.stringify({ connectionId: conn.id, heartbeatMs });
      send(conn, sseFrame('hello', hello, retryMs));
      // Over the cap, the oldest tabs are told why and closed.
      for (const old of mine.slice(0, Math.max(0, mine.length - maxPerUser))) close(old, bye);
      if (!timer) {
        timer = setInterval(() => {
          tick().catch((error: unknown) => log.warn({ err: error }, 'live: tick failed'));
        }, heartbeatMs);
        timer.unref();
      }
      return {
        id: conn.id,
        drained: () => {
          conn.blockedAt = null;
          flush(conn);
        },
        disconnect: () => close(conn),
      };
    },

    hasOpenTabs(userId) {
      return (byUser.get(userId)?.length ?? 0) > 0;
    },

    async updateTopics({ userId, connectionId, add = [], remove = [] }) {
      const conn = conns.get(connectionId);
      if (!conn || conn.userId !== userId) return null;
      const results: TopicResult[] = remove.map((topic) => {
        unsubscribe(conn, topic);
        return { topic, ok: true };
      });
      const adds = [...new Set(add)].map(async (topic): Promise<TopicResult> => {
        if (conn.topics.has(topic)) return { topic, ok: true };
        if (conn.topics.size + conn.pending.size >= maxTopics) return { topic, ok: false };
        const token = Symbol(topic);
        conn.pending.set(topic, token);
        let allowed = false;
        // Ask again if access changed while asking; after 3 changes in a row, refuse.
        for (let tries = 0; tries < 3; tries += 1) {
          const epoch = conn.epoch;
          const answer = await check(userId, topic);
          if (conn.closed || conn.pending.get(topic) !== token) return { topic, ok: false };
          if (conn.epoch === epoch) {
            allowed = answer;
            break;
          }
        }
        conn.pending.delete(topic);
        if (allowed) subscribe(conn, topic);
        return { topic, ok: allowed };
      });
      results.push(...(await Promise.all(adds)));
      return { results };
    },

    async recheckSubscriptions(userId) {
      const targets = userId === undefined ? [...conns.values()] : [...(byUser.get(userId) ?? [])];
      const rechecks: Promise<void>[] = [];
      for (const conn of targets) {
        conn.epoch += 1;
        for (const [topic, sub] of conn.topics) rechecks.push(recheck(conn, topic, sub));
      }
      await Promise.all(rechecks);
    },

    tick,

    closeAll() {
      for (const conn of [...conns.values()]) close(conn);
    },

    setLogger(next) {
      log = next;
    },

    stats() {
      let subscriptions = 0;
      for (const conn of conns.values()) subscriptions += conn.topics.size;
      return { connections: conns.size, users: byUser.size, subscriptions };
    },
  };
}
