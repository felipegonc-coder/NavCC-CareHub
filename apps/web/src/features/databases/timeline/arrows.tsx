import type { Id } from '@carehub/databases';
import type { DependencyArrow } from '@carehub/databases/dependencies';
import { arrowPath, type BarBox } from './model';

/** Line width of an arrow (SVG user units). */
const ARROW_STROKE = 1.5;

interface DependencyArrowsProps {
  arrows: readonly DependencyArrow[];
  /** Where each shown bar is; arrows to rows without one (collapsed, no dates) are left out. */
  boxes: ReadonlyMap<Id, BarBox>;
  width: number;
  height: number;
  /** How far under or over a bar's middle an arrow passes between lines, px. */
  turn: number;
}

/** "Blocked by" arrows, from the end of each blocking bar to the start of the bar it blocks. */
export function DependencyArrows({ arrows, boxes, width, height, turn }: DependencyArrowsProps) {
  const shown = arrows.flatMap((arrow) => {
    const from = boxes.get(arrow.fromId);
    const to = boxes.get(arrow.toId);
    return from && to ? [{ arrow, ...arrowPath(from, to, turn) }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 overflow-visible"
      width={width}
      height={height}
    >
      {shown.map(({ arrow, line, head }) => (
        <g
          key={`${arrow.fromId}:${arrow.toId}`}
          data-testid="timeline-arrow"
          data-from={arrow.fromId}
          data-to={arrow.toId}
          data-conflict={arrow.conflict ? 'true' : 'false'}
          className={arrow.conflict ? 'fill-danger stroke-danger' : 'fill-muted stroke-muted'}
        >
          <path d={line} fill="none" strokeWidth={ARROW_STROKE} />
          <path d={head} stroke="none" />
        </g>
      ))}
    </svg>
  );
}
