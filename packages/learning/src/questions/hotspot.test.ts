import { describe, expect, it } from 'vitest';
import type { Question } from '../format/index';
import { spotContainsPoint } from './index';

type Spot = Extract<Question, { type: 'hotspot' }>['spots'][number];

const spot = (shape: Spot['shape'], x: number, y: number, width: number, height: number): Spot => ({
  id: 's',
  shape,
  x,
  y,
  width,
  height,
  correct: true,
  label: 'Fictional button',
});

const rect = spot('rect', 10, 20, 30, 10); // x 10..40, y 20..30
const ellipse = spot('ellipse', 50, 50, 20, 10); // centre (60, 55), radii 10 and 5

const cases: { name: string; spot: Spot; x: number; y: number; inside: boolean }[] = [
  { name: 'rect: inside', spot: rect, x: 25, y: 25, inside: true },
  { name: 'rect: top-left corner (inclusive)', spot: rect, x: 10, y: 20, inside: true },
  { name: 'rect: bottom-right corner (inclusive)', spot: rect, x: 40, y: 30, inside: true },
  { name: 'rect: on the left edge', spot: rect, x: 10, y: 25, inside: true },
  { name: 'rect: just left', spot: rect, x: 9.99, y: 25, inside: false },
  { name: 'rect: just right', spot: rect, x: 40.01, y: 25, inside: false },
  { name: 'rect: just above', spot: rect, x: 25, y: 19.99, inside: false },
  { name: 'rect: just below', spot: rect, x: 25, y: 30.01, inside: false },
  {
    name: 'rect: edge after float rounding',
    spot: spot('rect', 10.1, 0, 20.2, 5),
    x: 30.3,
    y: 1,
    inside: true,
  },
  { name: 'ellipse: centre', spot: ellipse, x: 60, y: 55, inside: true },
  { name: 'ellipse: rightmost point (inclusive)', spot: ellipse, x: 70, y: 55, inside: true },
  { name: 'ellipse: top point (inclusive)', spot: ellipse, x: 60, y: 50, inside: true },
  { name: 'ellipse: bounding-box corner is outside', spot: ellipse, x: 50, y: 50, inside: false },
  { name: 'ellipse: inside near the corner', spot: ellipse, x: 54, y: 52, inside: true },
  { name: 'ellipse: outside near the corner', spot: ellipse, x: 52, y: 51.5, inside: false },
  { name: 'ellipse: just past the right', spot: ellipse, x: 70.01, y: 55, inside: false },
  {
    name: 'zero-width ellipse: on its line',
    spot: spot('ellipse', 5, 0, 0, 10),
    x: 5,
    y: 7,
    inside: true,
  },
  {
    name: 'zero-width ellipse: off its line',
    spot: spot('ellipse', 5, 0, 0, 10),
    x: 5.5,
    y: 5,
    inside: false,
  },
  {
    name: 'zero-width ellipse: past its end',
    spot: spot('ellipse', 5, 0, 0, 10),
    x: 5,
    y: 10.5,
    inside: false,
  },
  {
    name: 'negative size contains nothing',
    spot: spot('rect', 10, 10, -5, 5),
    x: 8,
    y: 12,
    inside: false,
  },
  { name: 'NaN point', spot: rect, x: Number.NaN, y: 25, inside: false },
  { name: 'infinite point', spot: rect, x: 25, y: Infinity, inside: false },
];

describe('spotContainsPoint', () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(spotContainsPoint(c.spot, c.x, c.y)).toBe(c.inside);
    });
  }
});
