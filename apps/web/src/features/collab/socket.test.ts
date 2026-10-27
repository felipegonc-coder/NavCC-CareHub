import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUILD,
  collabUrl,
  isSocketClose,
  onSocketProblem,
  releaseSocket,
  retainSocket,
  socketConnected,
} from './socket';

const fake = vi.hoisted(() => {
  interface SocketConfig {
    url: string;
    autoConnect: boolean;
    onClose(data: { event: unknown }): void;
  }
  const sockets: FakeSocket[] = [];
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
  return { sockets, FakeSocket };
});

vi.mock('@hocuspocus/provider', () => ({
  HocuspocusProviderWebsocket: fake.FakeSocket,
  WebSocketStatus: {
    Connecting: 'connecting',
    Connected: 'connected',
    Disconnected: 'disconnected',
  },
}));

function theSocket() {
  const socket = fake.sockets[0];
  if (!socket) throw new Error('No socket yet');
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('collabUrl', () => {
  it('uses the page origin, wss on https, and the build', () => {
    const build = encodeURIComponent(BUILD);
    expect(collabUrl({ protocol: 'https:', host: 'care.example.org' })).toBe(
      `wss://care.example.org/api/collab?build=${build}`,
    );
    expect(collabUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      `ws://localhost:5173/api/collab?build=${build}`,
    );
  });
});

describe('the tab socket', () => {
  it('connects while a page uses it and closes 30 s after the last one leaves', () => {
    retainSocket();
    retainSocket();
    const socket = theSocket();
    expect(socket.configuration).toMatchObject({
      url: collabUrl(window.location),
      autoConnect: false,
    });
    expect(socket.connect).toHaveBeenCalledTimes(1);
    socket.status = 'connected';
    expect(socketConnected()).toBe(true);
    releaseSocket();
    releaseSocket();
    vi.advanceTimersByTime(29_999);
    expect(socket.disconnect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.disconnect).toHaveBeenCalledTimes(1);
    socket.status = 'disconnected';
  });

  it('waits 10 s, then 30 s, before connecting again after "too fast"', () => {
    retainSocket();
    const socket = theSocket();
    socket.connect.mockClear();
    socket.configuration.onClose({ event: { code: 4429 } });
    expect(socket.shouldConnect).toBe(false);
    vi.advanceTimersByTime(9_999);
    expect(socket.connect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    socket.configuration.onClose({ event: { code: 4429 } });
    vi.advanceTimersByTime(29_999);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(socket.connect).toHaveBeenCalledTimes(2);
    releaseSocket();
  });

  it('tells the pages when the server signs you out, and stops connecting', () => {
    const listener = vi.fn();
    const unsubscribe = onSocketProblem(listener);
    retainSocket();
    const socket = theSocket();
    const event = { code: 4401 };
    socket.configuration.onClose({ event });
    expect(listener).toHaveBeenCalledWith('signed-out');
    expect(socket.shouldConnect).toBe(false);
    expect(isSocketClose(event)).toBe(true);
    expect(isSocketClose({ code: 1000, reason: 'forbidden' })).toBe(false);
    unsubscribe();
    releaseSocket();
  });
});
