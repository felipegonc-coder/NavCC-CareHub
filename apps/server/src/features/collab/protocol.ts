import * as decoding from 'lib0/decoding';

/** Hocuspocus message types: the number after the document name. */
export const MessageType = {
  Sync: 0,
  Awareness: 1,
  Auth: 2,
  QueryAwareness: 3,
  SyncReply: 4,
  Stateless: 5,
  BroadcastStateless: 6,
  Close: 7,
  Ping: 9,
  Pong: 10,
} as const;

/** Sync message steps (y-protocols). */
export const SyncStep = { One: 0, Two: 1, Update: 2 } as const;

/**
 * The types an editor may send (v4 providers know Ping and Pong; Hocuspocus ignores them).
 * BroadcastStateless is for servers only: from a client it could reach every editor of a page
 * with a forged access message.
 */
const CLIENT_TYPES = new Set<number>([
  MessageType.Sync,
  MessageType.Awareness,
  MessageType.Auth,
  MessageType.QueryAwareness,
  MessageType.SyncReply,
  MessageType.Stateless,
  MessageType.Close,
  MessageType.Ping,
  MessageType.Pong,
]);

const SYNC_STEPS = new Set<number>([SyncStep.One, SyncStep.Two, SyncStep.Update]);

export interface MessageHead {
  type: number;
  /** For sync messages: the step, and the update for steps two and updates. */
  step?: number;
  update?: Uint8Array;
}

/**
 * Reads the start of a message from a client: `[document name][type]`, then for sync messages
 * `[step][payload]`. It uses the lib0 decoders Hocuspocus uses, so both read the same message.
 * Null for anything it can't read or an editor doesn't send: the server refuses those.
 */
export function readMessageHead(data: Uint8Array): MessageHead | null {
  try {
    const decoder = decoding.createDecoder(data);
    decoding.readVarString(decoder);
    const type = decoding.readVarUint(decoder);
    if (!CLIENT_TYPES.has(type)) return null;
    let head: MessageHead = { type };
    if (type === MessageType.Sync || type === MessageType.SyncReply) {
      const step = decoding.readVarUint(decoder);
      if (!SYNC_STEPS.has(step)) return null;
      const payload = decoding.readVarUint8Array(decoder);
      head = step === SyncStep.One ? { type, step } : { type, step, update: payload };
    }
    // lib0 doesn't compare lengths with the message: a part may claim more than is there.
    return decoder.pos > data.length ? null : head;
  } catch {
    return null;
  }
}
