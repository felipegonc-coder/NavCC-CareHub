/** A nudge: ids only, at most 2 KB as JSON. Clients refetch through the normal, access-checked APIs. */
export type LiveEvent = { type: string; data?: Record<string, unknown> };

/** The largest event the hub sends, as UTF-8 JSON (topic included). */
export const MAX_EVENT_BYTES = 2048;

// Types starting with `live-` are reserved for the web client (`live-reconnected`).
const EVENT_TYPE = /^(?!live-)[A-Za-z][\w.:-]{0,63}$/;
const TOPIC = /^([a-z][a-z0-9-]{0,31}):\S{1,160}$/;
export const TOPIC_PREFIX = /^[a-z][a-z0-9-]{0,31}$/;

/** The prefix (owner) of a topic such as `chat:<conversationId>`, or null if it's malformed. */
export function topicPrefix(topic: string): string | null {
  return TOPIC.exec(topic)?.[1] ?? null;
}

/** One Server-Sent Events frame. A null `event` is the default `message` event. */
export function sseFrame(event: string | null, data: string, retryMs?: number): string {
  let frame = retryMs === undefined ? '' : `retry: ${retryMs}\n`;
  if (event) frame += `event: ${event}\n`;
  for (const line of data.split(/\r\n|\r|\n/)) frame += `data: ${line}\n`;
  return `${frame}\n`;
}

/** The frame for an app event (sent as the default `message` event), or why it can't be sent. */
export function encodeEvent(
  event: LiveEvent,
  topic?: string,
): { frame: string } | { error: string } {
  const { type, data } = event ?? {};
  if (typeof type !== 'string' || !EVENT_TYPE.test(type)) return { error: 'invalid event type' };
  if (data !== undefined && (data === null || typeof data !== 'object' || Array.isArray(data))) {
    return { error: 'data must be an object' };
  }
  let json: string;
  try {
    json = JSON.stringify(topic === undefined ? { type, data } : { topic, type, data });
  } catch {
    return { error: 'data is not JSON' };
  }
  if (Buffer.byteLength(json) > MAX_EVENT_BYTES) return { error: `over ${MAX_EVENT_BYTES} bytes` };
  return { frame: sseFrame(null, json) };
}
