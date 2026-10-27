import { describe, expect, it } from 'vitest';
import {
  PLAYER_TEXT_SIZES,
  parsePlayerTextSize,
  playerSidebar,
  playerTextScale,
  playerTextSizeLabel,
  stepPlayerTextSize,
} from './display';
import { DEFAULT_PLAYER_LABELS, continueBlockLabel, playerLabels } from './labels';
import { helpDesk } from './test-course';

describe('playerLabels', () => {
  it('uses the default words when the course renames nothing', () => {
    expect(playerLabels({ settings: {} })).toEqual({
      start: 'Start course',
      continue: 'Continue',
      next: 'Next lesson',
      complete: 'Complete lesson',
      submit: 'Submit',
      retry: 'Try again',
    });
    expect(playerLabels({ settings: {} })).not.toBe(DEFAULT_PLAYER_LABELS);
  });

  it("uses the course's renamed labels, trimmed, and ignores blank ones", () => {
    const labels = playerLabels(helpDesk);
    expect(labels.next).toBe('Onwards');
    expect(labels.continue).toBe('Continue');
    expect(
      playerLabels({ settings: { labels: { start: 'Begin', retry: 'Have another go' } } }),
    ).toMatchObject({
      start: 'Begin',
      retry: 'Have another go',
      submit: 'Submit',
    });
  });
});

describe('continueBlockLabel', () => {
  it("prefers the block's own label, then the course's continue label", () => {
    const labels = playerLabels({ settings: { labels: { continue: 'Keep going' } } });
    expect(continueBlockLabel({ label: "I'm ready" }, labels)).toBe("I'm ready");
    expect(continueBlockLabel({ label: '  ' }, labels)).toBe('Keep going');
    expect(continueBlockLabel({}, labels)).toBe('Keep going');
    expect(continueBlockLabel({}, DEFAULT_PLAYER_LABELS)).toBe('Continue');
  });
});

describe('playerSidebar', () => {
  it('shows no outline at all for hidden courses, on any screen', () => {
    expect(playerSidebar('hidden', { narrow: false })).toEqual({ kind: 'none' });
    expect(playerSidebar('hidden', { narrow: true, userOpen: true })).toEqual({ kind: 'none' });
  });

  it('starts the sidebar open unless the course says closed', () => {
    expect(playerSidebar(undefined, { narrow: false })).toEqual({ kind: 'sidebar', open: true });
    expect(playerSidebar('open', { narrow: false })).toEqual({ kind: 'sidebar', open: true });
    expect(playerSidebar('closed', { narrow: false })).toEqual({ kind: 'sidebar', open: false });
  });

  it('uses a menu that starts closed on phones', () => {
    expect(playerSidebar('open', { narrow: true })).toEqual({ kind: 'menu', open: false });
    expect(playerSidebar('closed', { narrow: true, userOpen: true })).toEqual({
      kind: 'menu',
      open: true,
    });
  });

  it("lets the learner's own choice win", () => {
    expect(playerSidebar('open', { narrow: false, userOpen: false })).toEqual({
      kind: 'sidebar',
      open: false,
    });
    expect(playerSidebar('closed', { narrow: false, userOpen: true })).toEqual({
      kind: 'sidebar',
      open: true,
    });
  });
});

describe('text size', () => {
  it('has four steps, from standard to largest', () => {
    expect(
      PLAYER_TEXT_SIZES.map((size) => [playerTextSizeLabel(size), playerTextScale(size)]),
    ).toEqual([
      ['Standard', 1],
      ['Large', 1.125],
      ['Larger', 1.25],
      ['Largest', 1.5],
    ]);
  });

  it('steps up and down and stops at the ends', () => {
    expect(stepPlayerTextSize('standard', 1)).toBe('large');
    expect(stepPlayerTextSize('larger', 1)).toBe('largest');
    expect(stepPlayerTextSize('largest', 1)).toBeNull();
    expect(stepPlayerTextSize('large', -1)).toBe('standard');
    expect(stepPlayerTextSize('standard', -1)).toBeNull();
  });

  it('reads a remembered size and falls back to standard', () => {
    expect(parsePlayerTextSize('larger')).toBe('larger');
    for (const value of [null, undefined, '', 'huge', 2, 'LARGE'])
      expect(parsePlayerTextSize(value)).toBe('standard');
  });
});
