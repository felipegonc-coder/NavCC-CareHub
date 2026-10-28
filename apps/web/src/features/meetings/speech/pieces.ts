import { SAMPLE_RATE } from './audio';

const FRAME = SAMPLE_RATE / 50; // 20 ms
const SOFT = 20 * 50; // frames: after 20 s, cut at the next pause
const MAX = 30 * 50; // frames: never longer than 30 s, the model's window
const PAUSE = 15; // frames of quiet that make a pause (300 ms)
const LOOK_BACK = 3 * 50; // frames: a forced cut goes at the quietest frame of the last 3 s
const HISTORY = 30 * 50; // frames the background level is taken from
const SPEECH = 10; // loud frames that make a piece worth transcribing
const NOISIEST = -40; // dB: louder than this, steady sound is talk, not background

/** A stretch of 16 kHz sound. `start` and `end` count samples from the recording's start. */
export type Piece = { start: number; end: number; samples: Float32Array; speech: boolean };

/** Cuts a stream of 16 kHz sound into pieces of up to 30 s, at pauses where it can. */
export class Cutter {
  private readonly buffer = new Float32Array(MAX * FRAME);
  private length = 0; // samples in the open piece
  private start = 0;
  private readonly levels = new Float32Array(MAX); // dB of each frame of the open piece
  private readonly loud = new Uint8Array(MAX);
  private readonly history = new Float32Array(HISTORY);
  private frames = 0; // frames measured so far
  private background = -70; // dB: the 10th percentile of the last 30 s, at most NOISIEST
  private quiet = 0; // quiet frames in a row at the end

  /** Samples pushed so far. */
  get position(): number {
    return this.start + this.length;
  }

  push(samples: Float32Array): Piece[] {
    const pieces: Piece[] = [];
    for (let offset = 0; offset < samples.length;) {
      const take = Math.min(samples.length - offset, FRAME - (this.length % FRAME));
      this.buffer.set(samples.subarray(offset, offset + take), this.length);
      this.length += take;
      offset += take;
      const piece = this.length % FRAME === 0 ? this.measure() : null;
      if (piece) pieces.push(piece);
    }
    return pieces;
  }

  /** The open piece so far. */
  current(): Piece {
    let loud = 0;
    for (let i = 0; i < Math.floor(this.length / FRAME); i += 1) loud += this.loud[i] ?? 0;
    const samples = this.buffer.slice(0, this.length);
    return { start: this.start, end: this.position, samples, speech: loud >= SPEECH };
  }

  /** Ends the open piece, at a pause or Stop. */
  flush(): Piece | null {
    if (this.length === 0) return null;
    const piece = this.current();
    this.start = this.position;
    this.length = 0;
    this.quiet = 0;
    return piece;
  }

  private measure(): Piece | null {
    const frame = this.length / FRAME - 1;
    let energy = 0;
    for (let i = this.length - FRAME; i < this.length; i += 1) energy += (this.buffer[i] ?? 0) ** 2;
    const level = 10 * Math.log10(energy / FRAME + 1e-10);
    this.levels[frame] = level;
    this.history[this.frames % HISTORY] = level;
    this.frames += 1;
    if (this.frames % 50 === 0 && this.frames >= 100) {
      const sorted = this.history.slice(0, Math.min(this.frames, HISTORY)).sort();
      this.background = Math.min(sorted[Math.floor(sorted.length / 10)] ?? -70, NOISIEST);
    }
    this.loud[frame] = level > Math.max(this.background + 12, -60) ? 1 : 0;
    this.quiet = level < this.background + 8 ? this.quiet + 1 : 0;
    if (frame + 1 >= SOFT && this.quiet >= PAUSE)
      return this.cut(frame + 1 - Math.floor(this.quiet / 2));
    if (frame + 1 < MAX) return null;
    let quietest = MAX - LOOK_BACK;
    for (let i = quietest; i < MAX; i += 1) {
      if ((this.levels[i] ?? 0) < (this.levels[quietest] ?? 0)) quietest = i;
    }
    return this.cut(quietest);
  }

  /** Cuts the open piece before `frame`; the rest starts the next one. */
  private cut(frame: number): Piece {
    const frames = this.length / FRAME;
    const end = frame * FRAME;
    let loud = 0;
    for (let i = 0; i < frame; i += 1) loud += this.loud[i] ?? 0;
    const samples = this.buffer.slice(0, end);
    const piece = { start: this.start, end: this.start + end, samples, speech: loud >= SPEECH };
    this.buffer.copyWithin(0, end, this.length);
    this.levels.copyWithin(0, frame, frames);
    this.loud.copyWithin(0, frame, frames);
    this.start += end;
    this.length -= end;
    this.quiet = Math.min(this.quiet, frames - frame);
    return piece;
  }
}
