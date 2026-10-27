import { LIMITS, type CropAspect, type Image } from '@carehub/learning';
import { Button, Checkbox, Field, Input, Textarea, cn } from '@carehub/ui';
import { Crop, RefreshCw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCourseId } from './course-scope';
import { CropDialog } from './CropDialog';
import { MediaPicker, type PickedMedia } from './MediaPicker';
import { useMediaUrl } from './media-url';

export type ImageFieldProps = {
  value: Image | undefined;
  onChange(next: Image | undefined): void;
  /** What the picture is for, such as "Cover picture". */
  label?: string;
  /** The course the picture belongs to. Defaults to the course in the page address (Studio). */
  courseId?: string;
  /** Offers a caption (pictures in lessons). Off for covers and header pictures. */
  caption?: boolean;
  /** Crops to this shape only, such as '16:9' for a cover. */
  aspect?: CropAspect;
  /** The picture can be replaced but not removed (blocks that need one). */
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

/** Where keyboard focus goes after a step closes. */
type FocusAfter = 'alt' | 'crop' | 'replace' | 'first';

const PICTURES = ['image'] as const;

/**
 * A picture with its alt text, "Decorative" and an optional caption: choose, drop or link a picture, crop it
 * (uploaded pictures), replace or remove it. Used for covers, header pictures, question pictures and image
 * blocks.
 */
export function ImageField({
  value,
  onChange,
  label = 'Picture',
  courseId,
  caption = true,
  aspect,
  required = false,
  disabled = false,
  className,
}: ImageFieldProps) {
  const course = useCourseId(courseId);
  const url = useMediaUrl(value?.media);
  const [replacing, setReplacing] = useState(false);
  const [cropping, setCropping] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string>();
  const root = useRef<HTMLFieldSetElement>(null);
  const altInput = useRef<HTMLTextAreaElement>(null);
  const cropButton = useRef<HTMLButtonElement>(null);
  const replaceButton = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<FocusAfter | undefined>(undefined);
  const broken = url === undefined || url === failedUrl;

  // After a step closes, focus moves to what comes next instead of the top of the page.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    focusAfter.current = undefined;
    const element: HTMLElement | null | undefined =
      target === 'alt'
        ? altInput.current
        : target === 'crop'
          ? cropButton.current
          : target === 'replace'
            ? replaceButton.current
            : root.current?.querySelector<HTMLElement>(
                'button:not(:disabled), input:not(:disabled):not([type="file"])',
              );
    element?.focus();
  });

  function pick(picked: PickedMedia) {
    const next: Image = { media: picked.media, alt: '' }; // a new picture needs its own description
    if (value?.caption) next.caption = value.caption;
    if (value?.decorative) next.decorative = true;
    focusAfter.current = next.decorative ? 'replace' : 'alt';
    setReplacing(false);
    onChange(next);
  }

  function remove() {
    focusAfter.current = 'first';
    setReplacing(false);
    onChange(undefined);
  }

  function closeCrop() {
    focusAfter.current = 'crop';
    setCropping(false);
  }

  function update(change: (next: Image) => void) {
    if (!value) return;
    const next: Image = { ...value };
    change(next);
    onChange(next);
  }

  return (
    <fieldset
      ref={root}
      disabled={disabled}
      className={cn('flex min-w-0 flex-col gap-3', className)}
    >
      <legend className="mb-2 text-small font-medium text-fg">{label}</legend>
      {!value || replacing ? (
        <>
          <MediaPicker
            accept={PICTURES}
            allowLink
            courseId={course}
            disabled={disabled}
            onPick={pick}
          />
          {replacing && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                focusAfter.current = 'replace';
                setReplacing(false);
              }}
            >
              Keep the current picture
            </Button>
          )}
        </>
      ) : (
        <>
          {broken ? (
            <p role="alert" className="text-small text-danger">
              This picture couldn&apos;t be loaded. Replace it, or remove it.
            </p>
          ) : (
            <img
              src={url}
              alt={value.decorative ? '' : value.alt}
              onError={() => setFailedUrl(url)}
              className="max-h-64 w-fit max-w-full rounded border border-border bg-fill object-contain"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {value.media.kind === 'file' && (
              <Button
                ref={cropButton}
                variant="secondary"
                size="sm"
                disabled={disabled || broken || !course}
                onClick={() => setCropping(true)}
              >
                <Crop aria-hidden />
                Crop
              </Button>
            )}
            <Button
              ref={replaceButton}
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => {
                focusAfter.current = 'first';
                setReplacing(true);
              }}
            >
              <RefreshCw aria-hidden />
              Replace
            </Button>
            {!required && (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={remove}>
                <Trash2 aria-hidden />
                Remove
              </Button>
            )}
          </div>
          <Field
            label="Alt text"
            hint="Describe what the picture shows, for people who can't see it."
          >
            <Textarea
              ref={altInput}
              rows={2}
              maxLength={LIMITS.shortText}
              value={value.alt}
              disabled={disabled || value.decorative === true}
              onChange={(event) => onChange({ ...value, alt: event.target.value })}
            />
          </Field>
          <Field
            label="Decorative"
            layout="inline"
            hint="It's only there for looks, so screen readers skip it."
          >
            <Checkbox
              checked={value.decorative === true}
              disabled={disabled}
              onCheckedChange={(checked) =>
                update((next) => {
                  if (checked === true) next.decorative = true;
                  else delete next.decorative;
                })
              }
            />
          </Field>
          {caption && (
            <Field label="Caption" hint="Optional. Shown under the picture.">
              <Input
                maxLength={LIMITS.shortText}
                value={value.caption ?? ''}
                disabled={disabled}
                onChange={(event) =>
                  update((next) => {
                    if (event.target.value) next.caption = event.target.value;
                    else delete next.caption;
                  })
                }
              />
            </Field>
          )}
        </>
      )}
      {cropping && value && url && course && (
        <CropDialog
          src={url}
          alt={value.decorative ? '' : value.alt}
          scope={`learning:${course}`}
          aspect={aspect}
          onCancel={closeCrop}
          onCropped={(cropped) => {
            onChange({ ...value, media: cropped.media });
            closeCrop();
          }}
        />
      )}
    </fieldset>
  );
}
