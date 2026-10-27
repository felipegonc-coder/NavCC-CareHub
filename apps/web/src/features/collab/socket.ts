import { HocuspocusProviderWebsocket, WebSocketStatus } from '@hocuspocus/provider';

/** This bundle's build. The collab server refuses pages to a tab from another build. */
export const BUILD = typeof __CAREHUB_VERSION__ === 'string' ? __CAREHUB_VERSION__ : '0.0.0-dev';

/** The collab endpoint on this origin, with the build the server checks. */
export function collabUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/collab?build=${encodeURIComponent(BUILD)}`;
}

/** Problems with the whole connection that the open pages must act on. */
export type SocketProblem = 'signed-out' | 'too-big';

/** How long to wait after "too fast" (4429): 10 s, then 30 s, then every minute. */
const TOO_FAST_WAIT_MS = [10_000, 30_000, 60_000];
/** The socket closes this long after the last page using it is closed. */
const IDLE_MS = 30_000;

let socket: HocuspocusProviderWebsocket | null = null;
let users = 0;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let waitTimer: ReturnType<typeof setTimeout> | undefined;
let lastClose: unknown = null;
let connectedAt = 0;
let tooFast = 0;
const problemListeners = new Set<(problem: SocketProblem) => void>();

function waitThenConnect(target: HocuspocusProviderWebsocket): void {
  const wait = TOO_FAST_WAIT_MS[Math.min(tooFast, TOO_FAST_WAIT_MS.length - 1)];
  tooFast += 1;
  clearTimeout(waitTimer);
  waitTimer = setTimeout(() => {
    waitTimer = undefined;
    if (users > 0) void target.connect();
  }, wait);
}

function createSocket(): HocuspocusProviderWebsocket {
  const created = new HocuspocusProviderWebsocket({
    url: collabUrl(window.location),
    autoConnect: false,
    onConnect: () => {
      connectedAt = Date.now();
    },
    // Runs before the socket's own handler, so disconnect() here stops its quick reconnect.
    onClose: ({ event }) => {
      lastClose = event;
      if (connectedAt && Date.now() - connectedAt >= 60_000) tooFast = 0;
      connectedAt = 0;
      const code = (event as { code?: unknown } | null)?.code;
      if (code === 4401) {
        created.disconnect();
        problemListeners.forEach((listener) => listener('signed-out'));
      } else if (code === 4429) {
        created.disconnect();
        waitThenConnect(created);
      } else if (code === 1009) {
        problemListeners.forEach((listener) => listener('too-big'));
      }
    },
  });
  // A dropped network can keep a dead socket open for a long time: close it now, and try again
  // as soon as the browser is back online.
  window.addEventListener('offline', () => created.webSocket?.close());
  window.addEventListener('online', () => {
    if (created.shouldConnect) void created.connect();
  });
  return created;
}

/** The tab's one collab socket, connected while at least one page uses it. */
export function retainSocket(): HocuspocusProviderWebsocket {
  users += 1;
  clearTimeout(idleTimer);
  socket ??= createSocket();
  if (!socket.shouldConnect && waitTimer === undefined) void socket.connect();
  return socket;
}

export function releaseSocket(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => socket?.disconnect(), IDLE_MS);
}

/** True while the socket is open (signing in to a page comes after). */
export function socketConnected(): boolean {
  return socket?.status === WebSocketStatus.Connected;
}

/** Whether a provider's close event is the socket closing, not the server closing one page. */
export function isSocketClose(event: unknown): boolean {
  return event !== null && event === lastClose;
}

export function onSocketProblem(listener: (problem: SocketProblem) => void): () => void {
  problemListeners.add(listener);
  return () => problemListeners.delete(listener);
}
