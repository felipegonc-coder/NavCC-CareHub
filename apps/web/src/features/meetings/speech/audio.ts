/** The models take 16 kHz mono sound. */
export const SAMPLE_RATE = 16_000;

const ZERO_CROSSINGS = 8; // on each side of the filter's centre
const STEPS = 256; // filter table entries per input sample

/** Changes mono sound to another sample rate as it streams in (Blackman-windowed sinc). */
export class Resampler {
  private readonly half: number; // filter half-width, in input samples
  private readonly table: Float32Array;
  private kept = new Float32Array(0); // input the next outputs still need
  private first = 0; // input index of kept[0]
  private next = 0; // index of the next output sample

  constructor(
    private readonly from: number,
    private readonly to = SAMPLE_RATE,
  ) {
    const cutoff = (0.45 * Math.min(from, to)) / from; // cycles per input sample, under Nyquist
    this.half = ZERO_CROSSINGS / (2 * cutoff);
    this.table = new Float32Array(Math.ceil(this.half * STEPS) + 2);
    for (let i = 0; i < this.table.length && i < this.half * STEPS; i += 1) {
      const d = i / STEPS;
      const x = Math.PI * 2 * cutoff * d;
      const window = 0.42 + 0.5 * Math.cos((Math.PI * d) / this.half);
      const edge = 0.08 * Math.cos((2 * Math.PI * d) / this.half);
      this.table[i] = (x === 0 ? 1 : Math.sin(x) / x) * (window + edge);
    }
  }

  push(input: Float32Array): Float32Array {
    if (this.from === this.to) return input;
    const kept = new Float32Array(this.kept.length + input.length);
    kept.set(this.kept);
    kept.set(input, this.kept.length);
    const end = this.first + kept.length;
    const out: number[] = [];
    for (;;) {
      const centre = (this.next * this.from) / this.to;
      if (Math.ceil(centre + this.half) > end) break;
      let sum = 0;
      let weights = 0;
      for (
        let k = Math.max(0, Math.floor(centre - this.half) + 1);
        k < centre + this.half;
        k += 1
      ) {
        const at = Math.abs(centre - k) * STEPS;
        const i = Math.floor(at);
        const a = this.table[i] ?? 0;
        const weight = a + ((this.table[i + 1] ?? 0) - a) * (at - i);
        sum += weight * (kept[k - this.first] ?? 0);
        weights += weight;
      }
      out.push(weights > 0 ? sum / weights : 0);
      this.next += 1;
    }
    const keepFrom = Math.max(0, Math.floor((this.next * this.from) / this.to - this.half) + 1);
    this.kept = kept.slice(Math.max(0, keepFrom - this.first));
    this.first = Math.max(this.first, keepFrom);
    return Float32Array.from(out);
  }
}

/** Sound is kept as 16-bit samples, half the size of floats. */
export function toPcm16(samples: Float32Array): Int16Array {
  return Int16Array.from(samples, (x) => Math.round(Math.max(-1, Math.min(1, x)) * 32767));
}

export function fromPcm16(pcm: Int16Array): Float32Array {
  return Float32Array.from(pcm, (x) => x / 32767);
}
