import type { Id, LabeledGraphicBlock } from '@carehub/learning';
import { cn, IconButton } from '@carehub/ui';
import { X } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Picture } from './Picture';
import { RichTextView } from './RichTextView';
import type { ViewProps } from './view-props';

/**
 * A picture with numbered spots. Each spot is a button (in order, so Tab goes through them) that opens its note
 * under the picture; the same button or "Close the note" closes it again.
 */
export function LabeledGraphicView({ block, course, go }: ViewProps<LabeledGraphicBlock>) {
  const [openId, setOpenId] = useState<Id>();
  const noteId = useId();
  const spots = useRef(new Map<Id, HTMLButtonElement>());
  const index = block.markers.findIndex((marker) => marker.id === openId);
  const open = block.markers[index];

  const close = () => {
    if (openId) spots.current.get(openId)?.focus();
    setOpenId(undefined);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Picture image={block.image} />
        {block.markers.map((marker, i) => (
          <button
            key={marker.id}
            ref={(button) => {
              if (button) spots.current.set(marker.id, button);
              else spots.current.delete(marker.id);
            }}
            type="button"
            aria-expanded={marker.id === openId}
            aria-controls={noteId}
            onClick={() => setOpenId(marker.id === openId ? undefined : marker.id)}
            style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
            className={cn(
              'absolute flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-bg text-small font-semibold shadow-menu before:absolute before:-inset-1.5',
              marker.id === openId ? 'bg-fg text-bg' : 'bg-primary text-primary-fg',
            )}
          >
            {i + 1}
            <span className="sr-only">: {marker.title}</span>
          </button>
        ))}
      </div>
      <div
        id={noteId}
        role="region"
        aria-label={open ? `${index + 1}: ${open.title}` : 'Spot notes'}
        hidden={!open}
        className="flex flex-col gap-2 rounded border border-border p-4"
      >
        {open && (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">
                {index + 1}. {open.title}
              </p>
              <IconButton label="Close the note" size="sm" onClick={close}>
                <X aria-hidden />
              </IconButton>
            </div>
            <RichTextView value={open.text} course={course} go={go} />
          </>
        )}
      </div>
    </div>
  );
}
