import { cn } from '@carehub/ui';
import type { MouseEvent } from 'react';
import { useMediaUrl } from '../media';
import { answerFor, type InputProps } from './answer';

/** A share of the picture, as a percent from 0 to 100 with one decimal. */
const percent = (part: number, whole: number) =>
  Math.round(Math.min(Math.max(part / whole, 0), 1) * 1000) / 10;

const box = (area: { x: number; y: number; width?: number; height?: number }) => ({
  left: `${area.x}%`,
  top: `${area.y}%`,
  ...(area.width === undefined ? {} : { width: `${area.width}%`, height: `${area.height}%` }),
});

/**
 * The picture to click or tap. Each area is also a button named by its label, so keyboard and
 * screen-reader users pick an area instead of a point.
 */
export function HotspotInput(props: InputProps<'hotspot'>) {
  const { question, onChange, disabled = false, labelledBy } = props;
  const src = useMediaUrl(question.image.media);
  const pick = answerFor('hotspot', props.response)?.pick;
  const pickPoint = (event: MouseEvent<HTMLButtonElement>) => {
    const frame = event.currentTarget.getBoundingClientRect();
    if (frame.width <= 0 || frame.height <= 0) return;
    const x = percent(event.clientX - frame.left, frame.width);
    const y = percent(event.clientY - frame.top, frame.height);
    onChange({ type: 'hotspot', pick: { kind: 'point', x, y } });
  };
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-2">
      <p className="text-small text-muted">
        Click or tap the right place on the picture. With a keyboard, press Tab to go through its
        areas.
      </p>
      <div className="relative w-full max-w-page overflow-hidden rounded border border-border">
        <img
          src={src}
          alt={question.image.decorative ? '' : question.image.alt}
          className="block w-full"
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onClick={pickPoint}
          className="absolute inset-0 cursor-crosshair disabled:cursor-not-allowed"
        />
        {question.spots.map((spot) => {
          const picked = pick?.kind === 'spot' && pick.spotId === spot.id;
          return (
            <button
              key={spot.id}
              type="button"
              aria-label={spot.label}
              aria-pressed={picked}
              disabled={disabled}
              onClick={() => onChange({ type: 'hotspot', pick: { kind: 'spot', spotId: spot.id } })}
              style={box(spot)}
              className={cn(
                'absolute cursor-crosshair disabled:cursor-not-allowed',
                spot.shape === 'ellipse' ? 'rounded-full' : 'rounded',
                picked && 'border-2 border-primary',
              )}
            />
          );
        })}
        {pick?.kind === 'point' && (
          <span
            aria-hidden
            style={box(pick)}
            className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-primary"
          />
        )}
      </div>
    </div>
  );
}
