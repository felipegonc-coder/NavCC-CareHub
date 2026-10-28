import { describe, expect, it } from 'vitest';
import { fromPcm16, Resampler, toPcm16 } from './audio';

function sine(rate: number, hz: number, seconds: number): Float32Array {
  return Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) =>
    Math.sin((2 * Math.PI * hz * i) / rate),
  );
}

function rms(samples: Float32Array): number {
  return Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length);
}

/** Largest difference from the same sine sampled at 16 kHz, away from the start. */
function sineError(samples: Float32Array, hz: number): number {
  let worst = 0;
  for (let i = 100; i < samples.length; i += 1) {
    worst = Math.max(
      worst,
      Math.abs((samples[i] ?? 0) - Math.sin((2 * Math.PI * hz * i) / 16_000)),
    );
  }
  return worst;
}

describe('Resampler', () => {
  it.each([48_000, 44_100, 22_050, 8_000])('keeps a 1 kHz tone from %s Hz', (rate) => {
    const out = new Resampler(rate).push(sine(rate, 1000, 1));
    expect(out.length).toBeGreaterThan(15_900);
    expect(out.length).toBeLessThanOrEqual(16_000);
    expect(sineError(out, 1000)).toBeLessThan(0.01);
  });

  it('removes sound above 8 kHz instead of folding it back', () => {
    const out = new Resampler(48_000).push(sine(48_000, 12_000, 1));
    expect(rms(out.subarray(100))).toBeLessThan(0.001);
  });

  it('gives the same result however the input is split', () => {
    const input = sine(44_100, 440, 0.5);
    const whole = new Resampler(44_100).push(input);
    const resampler = new Resampler(44_100);
    const parts: number[] = [];
    for (let i = 0; i < input.length; i += 1000) {
      parts.push(...resampler.push(input.subarray(i, i + 1000)));
    }
    expect(parts.length).toBe(whole.length);
    expect(Math.max(...parts.map((x, i) => Math.abs(x - (whole[i] ?? 0))))).toBeLessThan(1e-6);
  });

  it('passes 16 kHz through', () => {
    const input = sine(16_000, 440, 0.1);
    expect(new Resampler(16_000).push(input)).toEqual(input);
  });
});

describe('16-bit samples', () => {
  it('round-trips within one step and clips', () => {
    const pcm = toPcm16(Float32Array.from([0, 0.5, -0.25, 1, -1, 2, -3]));
    expect([...pcm]).toEqual([0, 16384, -8192, 32767, -32767, 32767, -32767]);
    expect(fromPcm16(pcm)[1]).toBeCloseTo(0.5, 4);
  });
});
