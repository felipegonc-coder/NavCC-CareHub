// The page cover (Pages and blocks, section 3.1): a picture from Care Hub's gallery or an upload,
// 160 px tall on phones and 280 px on computers, with Change, Reposition and Remove on hover.
import {
  Button,
  cn,
  coverGradients,
  coverNames,
  isCoverName,
  Popover,
  PopoverContent,
  PopoverTrigger,
  type CoverName,
} from '@carehub/ui';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { PageCover as Cover, PageDetail } from './api';
import { useChangePage } from './change';

const COVER_CLASSES = 'h-40 w-full md:h-[17.5rem]';
const clamp = (value: number) => Math.min(100, Math.max(0, value));
const nameOf = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

/** A gallery cover for "Add cover". */
export const randomCover = (random = Math.random): Cover => ({
  type: 'preset',
  name: coverNames[Math.floor(random() * coverNames.length)] ?? 'ocean',
});

/** The picture, showing the part at `position` (0 is its top, 100 its bottom). */
function CoverPicture({ cover, position }: { cover: Cover; position: number }) {
  if (cover.type === 'file') {
    return (
      <img
        src={`/api/files/${cover.fileId}`}
        alt="Page cover"
        className={cn(COVER_CLASSES, 'object-cover')}
        style={{ objectPosition: `center ${position}%` }}
      />
    );
  }
  const gradient = isCoverName(cover.name) ? coverGradients[cover.name] : undefined;
  return (
    <div
      role="img"
      aria-label="Page cover"
      className={cn(COVER_CLASSES, 'bg-fill')}
      // Taller than the cover, so Reposition has something to move.
      style={{
        backgroundImage: gradient,
        backgroundSize: '100% 250%',
        backgroundPosition: `center ${position}%`,
      }}
    />
  );
}

export function PageCover({ page, editable }: { page: PageDetail; editable: boolean }) {
  const change = useChangePage(page.id);
  const [placing, setPlacing] = useState<number | null>(null);
  if (!page.cover) return null;
  const preset = page.cover.type === 'preset' ? page.cover.name : null;

  return (
    <div className="group/cover relative">
      <CoverPicture cover={page.cover} position={placing ?? page.coverPosition} />
      {editable && placing === null && (
        <div className="absolute bottom-3 right-6 flex gap-1 md:opacity-0 md:focus-within:opacity-100 md:group-hover/cover:opacity-100">
          <CoverGallery
            current={preset}
            onPick={(name) => {
              const cover: Cover = { type: 'preset', name };
              void change({ cover }, { cover }, "Couldn't change the cover.");
            }}
          >
            <Button variant="secondary" size="sm">
              Change cover
            </Button>
          </CoverGallery>
          <Button variant="secondary" size="sm" onClick={() => setPlacing(page.coverPosition)}>
            Reposition
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void change({ cover: null }, { cover: null }, "Couldn't remove the cover.")
            }
          >
            Remove
          </Button>
        </div>
      )}
      {placing !== null && (
        <Repositioning
          value={placing}
          onChange={setPlacing}
          onCancel={() => setPlacing(null)}
          onSave={() => {
            setPlacing(null);
            const coverPosition = Math.round(placing);
            void change({ coverPosition }, { coverPosition }, "Couldn't move the cover.");
          }}
        />
      )}
    </div>
  );
}

interface CoverGalleryProps {
  current: string | null;
  onPick(name: CoverName): void;
  children: ReactElement;
}

function CoverGallery({ current, onPick, children }: CoverGalleryProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" aria-label="Covers" className="w-80">
        <h3 className="mb-2 text-label text-muted">Gallery</h3>
        <div className="grid grid-cols-4 gap-2">
          {coverNames.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={nameOf(name)}
              aria-pressed={current === name}
              onClick={() => {
                setOpen(false);
                onPick(name);
              }}
              className="h-12 rounded ring-ring ring-offset-2 aria-pressed:ring-2"
              style={{ backgroundImage: coverGradients[name] }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface RepositioningProps {
  value: number;
  onChange(value: number): void;
  onSave(): void;
  onCancel(): void;
}

/** Drag the cover up or down, or use ↑ and ↓; Enter saves and Esc cancels. */
function Repositioning({ value, onChange, onSave, onCancel }: RepositioningProps) {
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; from: number } | null>(null);
  useEffect(() => area.current?.focus(), []);
  const percent = Math.round(value);

  return (
    <>
      <div
        ref={area}
        role="slider"
        tabIndex={0}
        aria-label="Cover position"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}% from the top`}
        className="absolute inset-0 flex cursor-grab touch-none items-center justify-center focus:outline-none active:cursor-grabbing"
        onPointerDown={(event) => {
          drag.current = { y: event.clientY, from: value };
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const moved = (event.clientY - drag.current.y) / (event.currentTarget.clientHeight || 1);
          onChange(clamp(drag.current.from - moved * 100));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 10 : 2;
          if (event.key === 'ArrowUp') onChange(clamp(value + step));
          else if (event.key === 'ArrowDown') onChange(clamp(value - step));
          else if (event.key === 'Enter') onSave();
          else if (event.key === 'Escape') onCancel();
          else return;
          event.preventDefault();
        }}
      >
        <span className="rounded bg-bg px-2 py-1 text-small text-fg">Drag up or down</span>
      </div>
      <div className="absolute bottom-3 right-6 flex gap-1">
        <Button size="sm" onClick={onSave}>
          Save position
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>
  );
}
