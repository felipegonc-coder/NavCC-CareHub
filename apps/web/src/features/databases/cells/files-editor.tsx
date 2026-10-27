import { LIMITS, type FileRef } from '@carehub/databases';
import { VALUE_MESSAGES, validateValue } from '@carehub/databases/values';
import { Button, cn, IconButton, Input, Spinner } from '@carehub/ui';
import { Paperclip, Upload, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { FileChip } from './chips';
import { EditorShell } from './editor-shell';
import { commitDetails, webLinkFile } from './logic';
import { CELL_TEXT } from './messages';
import type { CellEditorProps, CellMove } from './types';

/** A saved file or web link, or an upload that is running or failed. */
type Entry = { key: string; ref: FileRef } | { key: string; upload: File; failed: boolean };

const readEntries = (v: unknown): Entry[] =>
  Array.isArray(v) ? (v as FileRef[]).map((ref) => ({ key: ref.id, ref })) : [];

/**
 * Files: uploads (when `onUpload` is given) and web links, up to 20. A failed upload shows Retry.
 * Saving waits for running uploads; failed ones are left out.
 */
export function FilesEditor({
  property,
  value,
  ctx,
  onUpload,
  onCommit,
  onCancel,
}: CellEditorProps) {
  const [entries, setEntries] = useState<Entry[]>(() => readEntries(value));
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const uploads = useRef(0);

  const replace = (key: string, next: Entry | null) =>
    setEntries((list) => list.flatMap((e) => (e.key !== key ? [e] : next ? [next] : [])));
  const run = (key: string, file: File) => {
    onUpload?.(file).then(
      (ref) => replace(key, { key, ref }),
      () => replace(key, { key, upload: file, failed: true }),
    );
  };
  const choose = (chosen: File[]) => {
    const room = Math.max(0, LIMITS.files - entries.length);
    setError(chosen.length > room ? VALUE_MESSAGES.files : null);
    const added = chosen.slice(0, room).map((file) => ({
      key: `upload-${uploads.current++}`,
      upload: file,
      failed: false,
    }));
    setEntries((list) => [...list, ...added]);
    for (const e of added) run(e.key, e.upload);
  };
  const retry = (key: string, file: File) => {
    replace(key, { key, upload: file, failed: false });
    run(key, file);
  };

  /** The list with the typed web link added, or why the link can't be added. */
  const withLink = (): Entry[] | string => {
    if (!link.trim()) return entries;
    const res = webLinkFile(link);
    if (!res.ok) return res.error;
    if (entries.length >= LIMITS.files) return VALUE_MESSAGES.files;
    return [...entries, { key: res.file.id, ref: res.file }];
  };
  const addLink = () => {
    const next = withLink();
    if (typeof next === 'string') return setError(next);
    setEntries(next);
    setLink('');
    setError(null);
  };
  const uploading = entries.some((e) => 'upload' in e && !e.failed);
  const save = (list: Entry[], move?: CellMove): boolean => {
    const res = validateValue(
      property,
      list.flatMap((e) => ('ref' in e ? [e.ref] : [])),
    );
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    onCommit(res.value, commitDetails(value ?? null, res.value, move));
    return true;
  };
  const commit = (move?: CellMove): boolean => {
    if (uploading) return false;
    const next = withLink();
    if (typeof next === 'string') {
      setError(next);
      return false;
    }
    return save(next, move);
  };
  const onLinkKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (link.trim()) addLink();
    else commit();
  };

  return (
    <EditorShell
      label={property.name}
      commit={commit}
      onOutside={() => {
        // Running uploads keep the editor open; a typed link that isn't valid is left out.
        if (!uploading && !save(entries)) onCancel();
      }}
      onCancel={() => onCancel()}
      initialFocus={onUpload ? uploadButton : linkInput}
      className="w-80 gap-2 p-2"
    >
      {entries.length > 0 && (
        <ul className="flex flex-col gap-1">
          {entries.map((e) => {
            const name = 'ref' in e ? e.ref.name : e.upload.name;
            return (
              <li key={e.key} className="flex min-w-0 items-center gap-2">
                {'ref' in e ? (
                  <FileChip file={e.ref} ctx={ctx} />
                ) : (
                  <span
                    className={cn(
                      'inline-flex min-w-0 items-center gap-1 text-small',
                      e.failed ? 'text-danger' : 'text-muted',
                    )}
                  >
                    {e.failed ? (
                      <Paperclip aria-hidden className="size-3.5 shrink-0" />
                    ) : (
                      <Spinner label={CELL_TEXT.uploading} />
                    )}
                    <span className="truncate">{name}</span>
                    {e.failed && <span className="shrink-0">· {CELL_TEXT.uploadFailed}</span>}
                  </span>
                )}
                <span className="ml-auto flex shrink-0 items-center">
                  {'upload' in e && e.failed && (
                    <Button variant="ghost" size="sm" onClick={() => retry(e.key, e.upload)}>
                      {CELL_TEXT.retry}
                    </Button>
                  )}
                  <IconButton
                    label={CELL_TEXT.remove(name)}
                    size="sm"
                    onClick={() => replace(e.key, null)}
                  >
                    <X aria-hidden className="size-4" />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {onUpload && (
        <div>
          <Button
            ref={uploadButton}
            variant="secondary"
            size="sm"
            onClick={() => picker.current?.click()}
          >
            <Upload aria-hidden className="size-4" />
            {CELL_TEXT.upload}
          </Button>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            aria-label={CELL_TEXT.upload}
            onChange={(e) => {
              choose(Array.from(e.target.files ?? []));
              e.target.value = '';
            }}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          ref={linkInput}
          type="text"
          inputMode="url"
          autoComplete="off"
          aria-label={CELL_TEXT.webLink}
          placeholder={CELL_TEXT.webLink}
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          onKeyDown={onLinkKey}
          className="h-8"
        />
        <Button variant="secondary" size="sm" className="shrink-0" onClick={addLink}>
          {CELL_TEXT.addLink}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </EditorShell>
  );
}
