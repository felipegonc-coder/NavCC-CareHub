import { describe, expect, it } from 'vitest';
import {
  createActiveTracker,
  stepActiveTracker,
  unsentActiveSeconds,
  type ActiveTimeChunk,
  type ActiveTracker,
  type ActiveTrackerInput,
} from './active-time';

const T = Date.UTC(2026, 9, 27, 15, 0, 0);
const s = (seconds: number) => T + seconds * 1000;

/** Runs the inputs in order and collects every chunk sent. */
function run(inputs: readonly ActiveTrackerInput[], start: ActiveTracker = createActiveTracker()) {
  let state = start;
  const chunks: ActiveTimeChunk[] = [];
  for (const input of inputs) {
    const step = stepActiveTracker(state, input);
    state = step.state;
    chunks.push(...step.chunks);
  }
  return { state, chunks, total: chunks.reduce((sum, chunk) => sum + chunk.seconds, 0) };
}

describe('active-time tracker', () => {
  it('counts visible time with recent activity and sends each full minute', () => {
    const { chunks, state } = run([
      { type: 'open', lessonId: 'l-1', at: s(0) },
      { type: 'activity', at: s(30) },
      { type: 'tick', at: s(59) },
    ]);
    expect(chunks).toEqual([]);
    expect(unsentActiveSeconds(state, s(59))).toBe(59);
    const next = stepActiveTracker(state, { type: 'tick', at: s(61.5) });
    expect(next.chunks).toEqual([{ lessonId: 'l-1', seconds: 60 }]);
    expect(unsentActiveSeconds(next.state, s(61.5))).toBe(1);
  });

  it('stops counting one minute after the last activity', () => {
    const { chunks, state } = run([
      { type: 'open', lessonId: 'l-1', at: s(0) },
      { type: 'activity', at: s(10) },
      { type: 'tick', at: s(300) },
      { type: 'tick', at: s(600) },
    ]);
    expect(chunks).toEqual([{ lessonId: 'l-1', seconds: 60 }]);
    expect(unsentActiveSeconds(state, s(900))).toBe(10);
  });

  it('never sends more than 60 seconds in one event', () => {
    const inputs: ActiveTrackerInput[] = [{ type: 'open', lessonId: 'l-1', at: s(0) }];
    for (let at = 50; at <= 200; at += 50) inputs.push({ type: 'activity', at: s(at) });
    inputs.push({ type: 'close', at: s(200) });
    const { chunks, total } = run(inputs);
    expect(chunks.every((chunk) => chunk.seconds >= 1 && chunk.seconds <= 60)).toBe(true);
    expect(chunks.map((chunk) => chunk.seconds)).toEqual([60, 60, 60, 20]);
    expect(total).toBe(200);
  });

  it('counts nothing while the page is hidden and sends the whole seconds when it hides', () => {
    const hidden = run([
      { type: 'open', lessonId: 'l-1', at: s(0) },
      { type: 'activity', at: s(20) },
      { type: 'visibility', visible: false, at: s(25.5) },
    ]);
    expect(hidden.chunks).toEqual([{ lessonId: 'l-1', seconds: 25 }]);
    const back = run(
      [
        { type: 'tick', at: s(400) },
        { type: 'visibility', visible: true, at: s(600) },
        { type: 'tick', at: s(630) },
        { type: 'close', at: s(630) },
      ],
      hidden.state,
    );
    expect(back.chunks).toEqual([{ lessonId: 'l-1', seconds: 30 }]);
  });

  it('can start hidden and counts from the moment the page shows', () => {
    const { total } = run(
      [
        { type: 'open', lessonId: 'l-1', at: s(0) },
        { type: 'tick', at: s(30) },
        { type: 'visibility', visible: true, at: s(30) },
        { type: 'close', at: s(45) },
      ],
      createActiveTracker(false),
    );
    expect(total).toBe(15);
  });

  it("sends the old lesson's time when the learner moves to another lesson", () => {
    const { chunks } = run([
      { type: 'open', lessonId: 'l-1', at: s(0) },
      { type: 'open', lessonId: 'l-2', at: s(42) },
      { type: 'close', at: s(52) },
    ]);
    expect(chunks).toEqual([
      { lessonId: 'l-1', seconds: 42 },
      { lessonId: 'l-2', seconds: 10 },
    ]);
  });

  it('treats opening the same lesson again as activity, not a move', () => {
    const { chunks, state } = run([
      { type: 'open', lessonId: 'l-1', at: s(0) },
      { type: 'open', lessonId: 'l-1', at: s(50) },
      { type: 'tick', at: s(100) },
    ]);
    expect(chunks).toEqual([{ lessonId: 'l-1', seconds: 60 }]);
    expect(unsentActiveSeconds(state, s(100))).toBe(40);
  });

  it('counts nothing when no lesson is open', () => {
    const { chunks, state } = run([
      { type: 'activity', at: s(0) },
      { type: 'tick', at: s(300) },
      { type: 'close', at: s(300) },
    ]);
    expect(chunks).toEqual([]);
    expect(unsentActiveSeconds(state, s(400))).toBe(0);
  });

  it('never counts more than a minute without activity when the clock goes backwards', () => {
    const { total, state } = run([
      { type: 'open', lessonId: 'l-1', at: s(0) },
      { type: 'tick', at: s(-3600) },
      { type: 'tick', at: s(-3000) },
      { type: 'close', at: s(-2400) },
    ]);
    expect(total).toBeLessThanOrEqual(60);
    expect(state.lessonId).toBeNull();
  });
});
