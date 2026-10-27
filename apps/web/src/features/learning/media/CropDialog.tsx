import {
  CROP_ASPECTS,
  changeCropAspect,
  initialCrop,
  moveCrop,
  planCrop,
  resizeCrop,
  type CropAspect,
  type CropHandle,
  type CropRect,
  type MediaRef,
  type PixelSize,
} from '@carehub/learning';
import { Button, cn } from '@carehub/ui';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { CropError, cropImage, croppedName } from './crop-image';
import { UploadError, uploadFile } from './files';
import { checkFile } from './read-file';

export type CropDialogProps = {
  /** The picture's address: an uploaded course file, so the browser may read its pixels. */
  src: string;
  /** The picture's alt text. */
  alt?: string;
  /** Where the cropped copy is uploaded: `learning:<courseId>`. */
  scope: string;
  /** Keeps the selection to this shape, such as '16:9'. Otherwise it starts free and the shape can be picked. */
  aspect?: CropAspect;
  onCancel(): void;
  /** The cropped copy, uploaded, and its size in pixels. */
  onCropped(cropped: { media: MediaRef; width: number; height: number }): void;
};

/** The picture as shown in the dialog and in its own pixels. */
type Sizes = { display: PixelSize; source: PixelSize };
type Drag = { handle: CropHandle | 'move'; x: number; y: number; start: CropRect };

const FAILED = "The cropped picture couldn't be saved. Try again.";
const UNREADABLE = "This picture couldn't be loaded, so it can't be cropped.";

const CORNERS: readonly { handle: CropHandle; className: string }[] = [
  { handle: 'nw', className: '-left-2 -top-2 cursor-nwse-resize' },
  { handle: 'ne', className: '-right-2 -top-2 cursor-nesw-resize' },
  { handle: 'sw', className: '-bottom-2 -left-2 cursor-nesw-resize' },
  { handle: 'se', className: '-bottom-2 -right-2 cursor-nwse-resize' },
];

const ARROWS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The picture's size on screen and in its own pixels, once it has loaded and is laid out. */
function sizesOf(picture: HTMLImageElement | null): Sizes | undefined {
  if (!picture?.naturalWidth || !picture.naturalHeight) return undefined;
  if (!picture.clientWidth || !picture.clientHeight) return undefined;
  return {
    display: { width: picture.clientWidth, height: picture.clientHeight },
    source: { width: picture.naturalWidth, height: picture.naturalHeight },
  };
}

/** The same selection on the picture shown at another size (the window was resized). */
function rescale(rect: CropRect, from: PixelSize, to: PixelSize): CropRect {
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

/** The four parts of the picture around the selection, which are dimmed. */
function shades(s: CropRect, d: PixelSize): CropRect[] {
  const right = s.x + s.width;
  const bottom = s.y + s.height;
  return [
    { x: 0, y: 0, width: d.width, height: s.y },
    { x: 0, y: bottom, width: d.width, height: d.height - bottom },
    { x: 0, y: s.y, width: s.x, height: s.height },
    { x: right, y: s.y, width: d.width - right, height: s.height },
  ];
}

const place = (rect: CropRect) => ({
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
});
const count = (n: number) => n.toLocaleString('en-US');

/**
 * Crops a picture: drag the box or its corners (or use the arrow keys, with Shift to resize), pick a shape,
 * then "Apply crop" draws the selection on a canvas and uploads it as a new course file.
 */
export function CropDialog({
  src,
  alt = '',
  scope,
  aspect: locked,
  onCancel,
  onCropped,
}: CropDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const shown = useRef<Sizes | undefined>(undefined);
  const drag = useRef<Drag | undefined>(undefined);
  const stop = useRef<AbortController | undefined>(undefined);
  const [aspect, setAspect] = useState<CropAspect>(locked ?? 'free');
  const [sizes, setSizes] = useState<Sizes>();
  const [selection, setSelection] = useState<CropRect>();
  const [saving, setSaving] = useState<number>();
  const [error, setError] = useState<string>();
  const titleId = useId();
  const helpId = useId();

  // Opened before the picture can load, so it is laid out when it does.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element || element.open) return;
    if (typeof element.showModal === 'function') element.showModal();
    else element.setAttribute('open', ''); // browsers without modal dialogs (and jsdom)
  }, []);

  useEffect(() => {
    const element = picture.current;
    const observer =
      element && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            const before = shown.current;
            const next = sizesOf(element);
            if (!before || !next || next.display.width === before.display.width) return;
            shown.current = next;
            setSizes(next);
            setSelection((rect) => rect && rescale(rect, before.display, next.display));
          })
        : undefined;
    if (element) observer?.observe(element);
    return () => {
      observer?.disconnect();
      stop.current?.abort(); // closing the dialog stops the upload
    };
  }, []);

  function loaded() {
    const next = sizesOf(picture.current);
    if (!next) return setError(UNREADABLE);
    shown.current = next;
    setSizes(next);
    setSelection(initialCrop(next.display, aspect));
  }

  function pickAspect(next: CropAspect) {
    setAspect(next);
    if (sizes) setSelection((rect) => rect && changeCropAspect(rect, next, sizes.display));
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const arrow = ARROWS[event.key];
    if (!arrow || !sizes) return;
    event.preventDefault();
    const { display } = sizes;
    const step = Math.max(1, Math.round(Math.min(display.width, display.height) / 50));
    const [dx, dy] = [arrow[0] * step, arrow[1] * step];
    const resize = event.shiftKey;
    setSelection(
      (rect) =>
        rect &&
        (resize
          ? resizeCrop(rect, 'se', dx, dy, display, aspect)
          : moveCrop(rect, dx, dy, display)),
    );
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!selection || event.button !== 0 || saving !== undefined) return;
    const handle = (event.target as HTMLElement).dataset.handle as CropHandle | undefined;
    drag.current = {
      handle: handle ?? 'move',
      x: event.clientX,
      y: event.clientY,
      start: selection,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || !sizes) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    setSelection(
      current.handle === 'move'
        ? moveCrop(current.start, dx, dy, sizes.display)
        : resizeCrop(current.start, current.handle, dx, dy, sizes.display, aspect),
    );
  }

  const endDrag = () => {
    drag.current = undefined;
  };

  function cancel() {
    stop.current?.abort();
    onCancel();
  }

  async function apply() {
    const element = picture.current;
    if (!element || !sizes || !selection || saving !== undefined) return;
    const controller = new AbortController();
    stop.current = controller;
    setError(undefined);
    setSaving(0);
    try {
      const plan = planCrop(selection, sizes.display, sizes.source, aspect);
      const blob = await cropImage(element, plan);
      const file = new File([blob], croppedName(blob.type), { type: blob.type });
      const check = await checkFile(file, ['image']);
      if (controller.signal.aborted) return;
      if (!check.ok) return setError(check.reason);
      const uploaded = await uploadFile(file, {
        scope,
        signal: controller.signal,
        onProgress: setSaving,
      });
      onCropped({
        media: { kind: 'file', fileId: uploaded.id },
        width: plan.output.width,
        height: plan.output.height,
      });
    } catch (caught) {
      if (controller.signal.aborted) return;
      const known = caught instanceof CropError || caught instanceof UploadError;
      setError(known ? caught.message : FAILED);
    } finally {
      stop.current = undefined;
      setSaving(undefined);
    }
  }

  const output =
    sizes && selection && planCrop(selection, sizes.display, sizes.source, aspect).output;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault(); // Escape: close through React, which removes the dialog
        cancel();
      }}
      className="m-auto w-full max-w-page rounded border border-border bg-bg p-6 text-fg shadow-dialog backdrop:bg-bg/80"
    >
      <div className="flex flex-col gap-4">
        <h2 id={titleId} className="text-title font-semibold">
          Crop picture
        </h2>
        {!locked && (
          <div role="group" aria-label="Shape" className="flex flex-wrap gap-2">
            {CROP_ASPECTS.map((option) => (
              <Button
                key={option.id}
                size="sm"
                variant={option.id === aspect ? 'primary' : 'secondary'}
                aria-pressed={option.id === aspect}
                disabled={saving !== undefined}
                onClick={() => pickAspect(option.id)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        )}
        <div className="relative mx-auto w-fit max-w-full touch-none select-none">
          <img
            ref={picture}
            src={src}
            alt={alt}
            draggable={false}
            onLoad={loaded}
            onError={() => setError(UNREADABLE)}
            className="block max-h-96 max-w-full"
          />
          {sizes && selection && (
            <>
              {shades(selection, sizes.display).map((shade, i) => (
                <div
                  key={i}
                  aria-hidden
                  className="pointer-events-none absolute bg-bg/70"
                  style={place(shade)}
                />
              ))}
              <div
                role="button"
                tabIndex={0}
                aria-label="Crop area"
                aria-describedby={helpId}
                onKeyDown={keyDown}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                className="absolute cursor-move border-2 border-primary-fg ring-1 ring-primary"
                style={place(selection)}
              >
                {CORNERS.map(({ handle, className }) => (
                  <span
                    key={handle}
                    data-handle={handle}
                    aria-hidden
                    className={cn(
                      'absolute size-4 rounded-sm border border-primary-fg bg-primary before:absolute before:-inset-3.5',
                      className,
                    )}
                  />
                ))}
              </div>
            </>
          )}
        </div>
        <p id={helpId} className="text-small text-muted">
          Drag the box or its corners. With the keyboard, the arrow keys move the box and Shift with
          the arrow keys resizes it.
        </p>
        {output && (
          <p aria-live="polite" className="text-small text-muted">
            The cropped picture will be {count(output.width)} × {count(output.height)} pixels.
          </p>
        )}
        {saving !== undefined && (
          <progress
            className="h-2 w-full accent-primary"
            max={1}
            value={saving}
            aria-label="Saving the cropped picture"
          />
        )}
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={cancel}>
            Cancel
          </Button>
          <Button loading={saving !== undefined} disabled={!output} onClick={() => void apply()}>
            Apply crop
          </Button>
        </div>
      </div>
    </dialog>
  );
}
