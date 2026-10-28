import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** With more rows than this on screen, only the rows near the screen are drawn. */
export const VIRTUAL_FROM = 1000;
/** A row's height until rows are measured: `min-h-9` and its border (px). */
export const ROW_GUESS = 37;
/** How far above and below the screen rows are drawn as well (px). */
export const OVERSCAN = 600;

/** Lines `start` (included) to `end` (left out) of a list. */
export interface Span {
  start: number;
  end: number;
}

export const NO_SPAN: Span = { start: 0, end: 0 };

/**
 * The lines of a list that are on the screen or within `overscan` of it. `top` is the list's top
 * edge; the screen runs from `screenTop` to `screenBottom` (px, measured the same way).
 */
export function spanOnScreen(
  heights: readonly number[],
  top: number,
  screenTop: number,
  screenBottom: number,
  overscan = OVERSCAN,
): Span {
  const from = screenTop - overscan;
  const to = screenBottom + overscan;
  let y = top;
  let start = 0;
  while (start < heights.length && y + (heights[start] ?? 0) <= from) {
    y += heights[start] ?? 0;
    start += 1;
  }
  let end = start;
  while (end < heights.length && y < to) {
    y += heights[end] ?? 0;
    end += 1;
  }
  return { start, end };
}

/** A line to draw (its index), or a gap as high as the lines it stands for (from index `gap`). */
export type Piece = { line: number } | { gap: number; height: number };

/**
 * What to draw of a list of `count` lines: the lines in the span and the pinned ones (the active
 * cell's row, an open menu's row), with gaps for the lines between.
 */
export function piecesOf(
  count: number,
  heightAt: (index: number) => number,
  span: Span,
  pinned: ReadonlySet<number>,
): Piece[] {
  const pieces: Piece[] = [];
  let gap = -1;
  let height = 0;
  for (let index = 0; index < count; index += 1) {
    if ((index >= span.start && index < span.end) || pinned.has(index)) {
      if (gap >= 0) pieces.push({ gap, height });
      gap = -1;
      height = 0;
      pieces.push({ line: index });
    } else {
      if (gap < 0) gap = index;
      height += heightAt(index);
    }
  }
  if (gap >= 0) pieces.push({ gap, height });
  return pieces;
}

export function sameSpans(a: ReadonlyMap<string, Span>, b: ReadonlyMap<string, Span>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, span] of a) {
    const other = b.get(key);
    if (!other || other.start !== span.start || other.end !== span.end) return false;
  }
  return true;
}

/** A list drawn in part: its top edge (px from the screen's top) and its lines' heights. */
export interface ListOnScreen {
  top: number;
  heights: readonly number[];
}

export interface ScreenLists {
  lists: ReadonlyMap<string, ListOnScreen>;
  /** A drawn line's height changed since the last read, so the gaps are drawn again. */
  resized: boolean;
}

const NO_SPANS: ReadonlyMap<string, Span> = new Map();

/**
 * Which lines of each list are near the screen. `read` runs after every render and on any scroll
 * (of the page or a box around the table) or resize, at most once a frame. Off: no spans.
 */
export function useScreenSpans(on: boolean, read: () => ScreenLists): ReadonlyMap<string, Span> {
  const [state, setState] = useState({ spans: NO_SPANS });
  const reader = useRef(read);
  const update = useCallback(() => {
    const { lists, resized } = reader.current();
    const screen = window.innerHeight || document.documentElement.clientHeight;
    const spans = new Map<string, Span>();
    for (const [key, list] of lists) {
      spans.set(key, spanOnScreen(list.heights, list.top, 0, screen));
    }
    setState((current) => (!resized && sameSpans(current.spans, spans) ? current : { spans }));
  }, []);

  useLayoutEffect(() => {
    reader.current = read;
    if (on) update();
  });

  useEffect(() => {
    if (!on) return undefined;
    let frame = 0;
    const later = () => {
      if (frame !== 0) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    window.addEventListener('scroll', later, { capture: true, passive: true });
    window.addEventListener('resize', later);
    return () => {
      window.removeEventListener('scroll', later, { capture: true });
      window.removeEventListener('resize', later);
      window.cancelAnimationFrame(frame);
    };
  }, [on, update]);

  return on ? state.spans : NO_SPANS;
}
