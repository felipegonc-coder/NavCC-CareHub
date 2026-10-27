import type { ServerResponse } from 'node:http';
import type { LiveConnection, LiveHub } from './domain/hub';

/**
 * No caching, no transforms (compression) and no proxy buffering. `connection: close` frees the
 * socket when the stream ends, so a server shutdown isn't held up by kept-alive stream sockets.
 */
export const LIVE_STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-store, no-transform',
  'x-accel-buffering': 'no',
  connection: 'close',
} as const;

/** Streams a new hub connection for `userId` over `res`, with backpressure and clean-up. */
export function openLiveStream(hub: LiveHub, userId: string, res: ServerResponse): LiveConnection {
  res.writeHead(200, LIVE_STREAM_HEADERS);
  res.socket?.setNoDelay(true);
  res.socket?.setKeepAlive(true);
  const connection = hub.connect(userId, {
    write: (frame) => res.destroyed || res.writableEnded || res.write(frame),
    end: () => {
      if (!res.destroyed && !res.writableEnded) res.end();
    },
  });
  res.on('drain', connection.drained);
  res.on('close', connection.disconnect);
  return connection;
}
