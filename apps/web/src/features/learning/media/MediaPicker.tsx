import {
  MEDIA_KIND_INFO,
  acceptAttribute,
  formatBytes,
  isHttpsUrl,
  mediaSource,
  sizeLimit,
  type MediaKind,
  type MediaRef,
} from '@carehub/learning';
import { Button, Field, Input, cn } from '@carehub/ui';
import { Upload } from 'lucide-react';
import { useEffect, useId, useRef, useState, type DragEvent } from 'react';
import { useCourseId } from './course-scope';
import { uploadFile, uploadFromUrl } from './files';
import { checkFile } from './read-file';

/** What was picked: an uploaded course file or a link, with what is known about it. */
export type PickedMedia = {
  media: MediaRef;
  kind: MediaKind;
  /** The file's clean name, or the link. */
  name: string;
  /** In bytes, for uploads. */
  size?: number;
  /** In pixels, for uploaded pictures. */
  width?: number;
  height?: number;
};

export type MediaPickerProps = {
  /** The kinds of file it takes, such as `['image']` or `['video']`. */
  accept: readonly MediaKind[];
  onPick(picked: PickedMedia): void;
  /** The course the file belongs to. Defaults to the course in the page address (Studio). */
  courseId?: string;
  /**
   * Also offer "Or paste a link". A picture link is copied into the course's files (pictures from other sites
   * don't load in Care Hub); a video link must be from one of the video sites.
   */
  allowLink?: boolean;
  /** The button's text. */
  label?: string;
  disabled?: boolean;
  className?: string;
};

/** An upload in progress, or a picture being copied from a link (no progress then). */
type Sending = { name: string; progress?: number; copying?: boolean };

const FAILED = "The file couldn't be uploaded. Try again.";
const SAVE_FIRST = 'Save the course before adding files.';

/** "a picture", "a video or an audio file". */
const nouns = (kinds: readonly MediaKind[]) =>
  kinds.map((kind) => MEDIA_KIND_INFO[kind].noun).join(' or ');

/** Whether a pasted link can be used as one of the kinds, and as which; otherwise why not. */
function checkLink(
  url: string,
  accept: readonly MediaKind[],
): { ok: true; kind: MediaKind } | { ok: false; reason: string } {
  let reason = 'Paste a full link that starts with https://.';
  for (const kind of accept) {
    if (kind === 'video' || kind === 'audio') {
      const source = mediaSource({ kind: 'url', url }, kind);
      if (source.kind !== 'refused') return { ok: true, kind };
      reason = source.reason;
    } else if (kind === 'image' && isHttpsUrl(url)) {
      return { ok: true, kind };
    }
  }
  return { ok: false, reason };
}

/**
 * Choose or drop a file: it is checked in the browser, uploaded to the course with a progress bar, and handed
 * to `onPick`. Problems are shown in plain words. With `allowLink`, a link can be pasted instead.
 */
export function MediaPicker({
  accept,
  onPick,
  courseId,
  allowLink = false,
  label = 'Choose a file',
  disabled = false,
  className,
}: MediaPickerProps) {
  const course = useCourseId(courseId);
  const input = useRef<HTMLInputElement>(null);
  const stop = useRef<AbortController | undefined>(undefined);
  const [upload, setUpload] = useState<Sending>();
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState('');
  const [linkError, setLinkError] = useState<string>();
  const hintId = useId();
  const canUpload = !disabled && course !== undefined && upload === undefined;

  useEffect(() => () => stop.current?.abort(), []); // leaving the page stops the upload

  async function take(file: File) {
    if (!canUpload) return;
    const controller = new AbortController();
    stop.current = controller;
    setError(undefined);
    setUpload({ name: file.name, progress: 0 });
    try {
      const check = await checkFile(file, accept);
      if (controller.signal.aborted) return;
      if (!check.ok) return setError(check.reason);
      const uploaded = await uploadFile(file, {
        scope: `learning:${course}`,
        signal: controller.signal,
        onProgress: (progress) => setUpload({ name: file.name, progress }),
      });
      onPick({
        media: { kind: 'file', fileId: uploaded.id },
        kind: check.kind,
        name: uploaded.name,
        size: uploaded.size,
        width: uploaded.width ?? check.width,
        height: uploaded.height ?? check.height,
      });
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : FAILED);
    } finally {
      stop.current = undefined;
      setUpload(undefined);
    }
  }

  async function copyPicture(url: string) {
    const controller = new AbortController();
    stop.current = controller;
    setError(undefined);
    setLinkError(undefined);
    setUpload({ name: url, copying: true });
    try {
      const copied = await uploadFromUrl(url, {
        scope: `learning:${course}`,
        signal: controller.signal,
      });
      setLink('');
      onPick({
        media: { kind: 'file', fileId: copied.id },
        kind: 'image',
        name: copied.name,
        size: copied.size,
        width: copied.width,
        height: copied.height,
      });
    } catch (caught) {
      if (!controller.signal.aborted)
        setLinkError(caught instanceof Error ? caught.message : FAILED);
    } finally {
      stop.current = undefined;
      setUpload(undefined);
    }
  }

  function pickLink() {
    const url = link.trim();
    const checked = checkLink(url, accept);
    if (!checked.ok) return setLinkError(checked.reason);
    if (checked.kind === 'image') {
      if (course === undefined) return setLinkError(SAVE_FIRST);
      return void copyPicture(url);
    }
    setLinkError(undefined);
    setLink('');
    onPick({ media: { kind: 'url', url }, kind: checked.kind, name: url });
  }

  function dragOver(event: DragEvent<HTMLDivElement>) {
    if (!canUpload) return;
    event.preventDefault(); // allows the drop
    setDragging(true);
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) void take(file);
  }

  const formats = accept.map((kind) => MEDIA_KIND_INFO[kind].formats).join('; ');
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        onDragEnter={dragOver}
        onDragOver={dragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        className={cn(
          'flex flex-col items-center gap-2 rounded border border-dashed border-border p-6 text-center',
          dragging && 'border-ring bg-fill',
        )}
      >
        {upload ? (
          <>
            <p className="text-small text-fg">
              {upload.copying ? 'Copying the picture from the link' : `Uploading ${upload.name}`}
            </p>
            <progress
              className="h-2 w-full accent-primary"
              max={1}
              value={upload.progress}
              aria-label={upload.copying ? 'Copying the picture' : `Uploading ${upload.name}`}
            />
            <Button variant="secondary" size="sm" onClick={() => stop.current?.abort()}>
              {upload.copying ? 'Cancel' : 'Cancel upload'}
            </Button>
          </>
        ) : (
          <>
            <Upload aria-hidden className="size-5 text-muted" />
            <p className="text-small text-muted">Drop {nouns(accept)} here, or</p>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canUpload}
              aria-describedby={hintId}
              onClick={() => input.current?.click()}
            >
              {label}
            </Button>
            <p id={hintId} className="text-label text-muted">
              {course ? `${formats}, up to ${formatBytes(sizeLimit(accept))}.` : SAVE_FIRST}
            </p>
            <input
              ref={input}
              type="file"
              accept={acceptAttribute(accept)}
              tabIndex={-1}
              aria-hidden
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = ''; // so choosing the same file again still works
                if (file) void take(file);
              }}
            />
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      {allowLink && (
        <Field label="Or paste a link" error={linkError}>
          <div className="flex gap-2">
            <Input
              type="url"
              inputMode="url"
              placeholder="https://"
              value={link}
              disabled={disabled || upload !== undefined}
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                pickLink();
              }}
            />
            <Button
              variant="secondary"
              disabled={disabled || upload !== undefined || link.trim() === ''}
              onClick={pickLink}
            >
              Use link
            </Button>
          </div>
        </Field>
      )}
    </div>
  );
}
