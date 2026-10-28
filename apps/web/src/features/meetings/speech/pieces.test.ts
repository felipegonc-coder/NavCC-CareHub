import { describe, expect, it } from 'vitest';
import { Cutter, type Piece } from './pieces';

const RATE = 16_000;
let seed = 1;
/** Deterministic noise. */
const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

/** Talking: a loud tone. Quiet: faint room noise. */
const talk = (seconds: number) =>
  Float32Array.from({ length: seconds * RATE }, (_, i) => 0.3 * Math.sin(i / 8) + 0.01 * noise());
const quiet = (seconds: number) =>
  Float32Array.from({ length: seconds * RATE }, () => 0.001 * noise());

function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function cut(sound: Float32Array, chunk = 4096): { pieces: Piece[]; cutter: Cutter } {
  const cutter = new Cutter();
  const pieces: Piece[] = [];
  for (let i = 0; i < sound.length; i += chunk)
    pieces.push(...cutter.push(sound.subarray(i, i + chunk)));
  return { pieces, cutter };
}

const seconds = (samples: number) => samples / RATE;

describe('Cutter', () => {
  it('cuts at the first pause after 20 s', () => {
    const sound = join(quiet(2), talk(8), quiet(0.5), talk(12), quiet(0.5), talk(10));
    const { pieces } = cut(sound);
    expect(pieces).toHaveLength(1);
    const [piece] = pieces;
    expect(seconds(piece?.end ?? 0)).toBeGreaterThan(22.5);
    expect(seconds(piece?.end ?? 0)).toBeLessThan(23);
    expect(piece?.start).toBe(0);
    expect(piece?.speech).toBe(true);
    expect(piece?.samples.length).toBe(piece?.end);
  });

  it('never makes a piece longer than 30 s', () => {
    const { pieces, cutter } = cut(join(quiet(2), talk(70)));
    expect(pieces.length).toBe(2);
    for (const piece of pieces) {
      expect(seconds(piece.end - piece.start)).toBeLessThanOrEqual(30);
      expect(seconds(piece.end - piece.start)).toBeGreaterThanOrEqual(27);
    }
    expect(pieces[1]?.start).toBe(pieces[0]?.end);
    const rest = cutter.flush();
    expect(rest?.start).toBe(pieces[1]?.end);
    expect(rest?.end).toBe(72 * RATE);
    expect(cutter.position).toBe(72 * RATE);
  });

  it('marks pieces without speech', () => {
    const { pieces } = cut(quiet(61));
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.every((piece) => !piece.speech)).toBe(true);
  });

  it('cuts in the same places however the sound arrives', () => {
    const sound = join(quiet(1), talk(21), quiet(1), talk(40), quiet(0.4), talk(5));
    const ends = (chunk: number) => cut(sound, chunk).pieces.map((piece) => piece.end);
    expect(ends(4096)).toEqual(ends(333));
    expect(ends(4096).length).toBeGreaterThan(1);
  });

  it('gives the open piece so far, and flushes it', () => {
    const cutter = new Cutter();
    cutter.push(join(quiet(1), talk(2)));
    expect(cutter.current()).toMatchObject({ start: 0, end: 3 * RATE, speech: true });
    expect(cutter.flush()?.samples.length).toBe(3 * RATE);
    expect(cutter.flush()).toBeNull();
    cutter.push(talk(1));
    expect(cutter.current()).toMatchObject({ start: 3 * RATE, end: 4 * RATE });
  });
});
