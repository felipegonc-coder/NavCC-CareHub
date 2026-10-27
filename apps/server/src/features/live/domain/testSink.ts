import type { LiveSink } from './hub';

export interface ParsedFrame {
  event: string;
  data: unknown;
  retry?: number;
}

/** Parses Server-Sent Events frames (test helper). */
export function parseFrames(text: string): ParsedFrame[] {
  return text
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const frame: ParsedFrame = { event: 'message', data: undefined };
      const data: string[] = [];
      for (const line of block.split('\n')) {
        const [field, ...rest] = line.split(': ');
        const value = rest.join(': ');
        if (field === 'event') frame.event = value;
        if (field === 'data') data.push(value);
        if (field === 'retry') frame.retry = Number(value);
      }
      frame.data = JSON.parse(data.join('\n'));
      return frame;
    });
}

/** A sink that records frames; `accept` false makes it report backpressure (test helper). */
export function testSink() {
  const state = { written: [] as string[], ended: false, accept: true };
  const sink: LiveSink = {
    write: (frame) => {
      state.written.push(frame);
      return state.accept;
    },
    end: () => {
      state.ended = true;
    },
  };
  return Object.assign(state, {
    sink,
    frames: () => parseFrames(state.written.join('')),
    events: () => parseFrames(state.written.join('')).filter((frame) => frame.event === 'message'),
  });
}
