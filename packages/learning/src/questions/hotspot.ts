import type { HotspotSpot } from '../format/index';

/** Slack for points exactly on an edge, which floating-point rounding can push just outside. */
const EDGE = 1e-9;

/**
 * True when the point (x, y), in % of the image, is inside the spot. Rectangles include their
 * edges; ellipses use the ellipse equation, edge included (a zero-width or zero-height ellipse is a
 * line).
 */
export function spotContainsPoint(spot: HotspotSpot, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || spot.width < 0 || spot.height < 0) return false;
  if (spot.shape === 'rect') {
    return (
      x >= spot.x - EDGE &&
      x <= spot.x + spot.width + EDGE &&
      y >= spot.y - EDGE &&
      y <= spot.y + spot.height + EDGE
    );
  }
  const rx = spot.width / 2;
  const ry = spot.height / 2;
  const dx = x - (spot.x + rx);
  const dy = y - (spot.y + ry);
  if (rx === 0 || ry === 0) return Math.abs(dx) <= rx + EDGE && Math.abs(dy) <= ry + EDGE;
  return (dx / rx) ** 2 + (dy / ry) ** 2 <= 1 + EDGE;
}
