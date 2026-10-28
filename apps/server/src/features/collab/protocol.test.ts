import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import { MessageType, SyncStep, readMessageHead } from './protocol';

/** A message to one page: the document name, then whatever `write` adds. */
function message(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarString(encoder, 'a-page');
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function sync(type: number, step: number, payload: Uint8Array) {
  return message((encoder) => {
    encoding.writeVarUint(encoder, type);
    encoding.writeVarUint(encoder, step);
    encoding.writeVarUint8Array(encoder, payload);
  });
}

describe('readMessageHead', () => {
  const update = Uint8Array.from([1, 2, 3]);

  it('reads sync messages the way Hocuspocus does', () => {
    // Zero written in nine bytes is still zero to lib0, so this is a sync message.
    const overlong = message((encoder) => {
      encoding.writeUint8Array(
        encoder,
        Uint8Array.from([128, 128, 128, 128, 128, 128, 128, 128, 0]),
      );
      encoding.writeVarUint(encoder, SyncStep.Update);
      encoding.writeVarUint8Array(encoder, update);
    });
    const head = { type: MessageType.Sync, step: SyncStep.Update, update };
    expect(readMessageHead(sync(MessageType.Sync, SyncStep.Update, update))).toEqual(head);
    expect(readMessageHead(overlong)).toEqual(head);
    expect(readMessageHead(sync(MessageType.SyncReply, SyncStep.One, update))).toEqual({
      type: MessageType.SyncReply,
      step: SyncStep.One,
    });
    expect(readMessageHead(message((e) => encoding.writeVarUint(e, MessageType.Ping)))).toEqual({
      type: MessageType.Ping,
    });
  });

  it('gives up on anything it can’t read and on what an editor never sends', () => {
    const truncated = message((encoder) => {
      encoding.writeVarUint(encoder, MessageType.Sync);
      encoding.writeVarUint(encoder, SyncStep.Update);
      encoding.writeVarUint(encoder, 100);
      encoding.writeUint8Array(encoder, update);
    });
    const unreadable = [
      new Uint8Array(0),
      truncated,
      sync(MessageType.Sync, 7, update),
      message((encoder) => encoding.writeVarUint(encoder, MessageType.BroadcastStateless)),
      message((encoder) => encoding.writeVarUint(encoder, 99)),
    ];
    for (const data of unreadable) expect(readMessageHead(data)).toBeNull();
  });
});
