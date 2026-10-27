/** Hocuspocus message types the collab server looks at. */
export const MessageType = {
  Sync: 0,
  Awareness: 1,
  Auth: 2,
  SyncReply: 4,
  Stateless: 5,
  BroadcastStateless: 6,
  Close: 7,
} as const;

/** Sync message steps (y-protocols). */
export const SyncStep = { One: 0, Two: 1, Update: 2 } as const;

/** Reads lib0 variable-length numbers, byte arrays and strings. */
export class Reader {
  private readonly data: Uint8Array;
  private position = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  uint(): number {
    let value = 0;
    let scale = 1;
    for (;;) {
      const byte = this.data[this.position++];
      if (byte === undefined || scale > 2 ** 49) throw new RangeError('Bad message');
      value += (byte & 0x7f) * scale;
      if (byte < 0x80) return value;
      scale *= 128;
    }
  }

  bytes(): Uint8Array {
    const length = this.uint();
    if (this.position + length > this.data.length) throw new RangeError('Bad message');
    const out = this.data.subarray(this.position, this.position + length);
    this.position += length;
    return out;
  }

  string(): string {
    return new TextDecoder().decode(this.bytes());
  }
}

export interface MessageHead {
  type: number;
  /** For sync messages: the step, and the update for steps two and updates. */
  step?: number;
  update?: Uint8Array;
}

/** The start of a message from a client: `[document name][type]`, then sync details. */
export function readMessageHead(data: Uint8Array): MessageHead | null {
  try {
    const reader = new Reader(data);
    reader.bytes();
    const type = reader.uint();
    if (type !== MessageType.Sync && type !== MessageType.SyncReply) return { type };
    const step = reader.uint();
    return step === SyncStep.One ? { type, step } : { type, step, update: reader.bytes() };
  } catch {
    return null;
  }
}
