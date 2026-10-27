import {
  LIMITS,
  VideoBlockSchema,
  transcriptToRichText,
  vttToTranscript,
  type VideoBlock,
} from '@carehub/learning';
import { Button, Field, IconButton, Input } from '@carehub/ui';
import { FileText, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MediaPicker, mediaUrl } from '../../../media';
import type { EditorProps } from './editor-props';
import { CheckedField, type Checked } from './CheckedField';
import { optionalText, withOptional } from './fields';

type Captions = NonNullable<VideoBlock['captions']>[number];

const CAPTIONS = ['captions'] as const;
const LANGUAGE = VideoBlockSchema.shape.captions.unwrap().element.shape.language;

function checkLanguage(text: string): Checked<string> {
  const checked = LANGUAGE.safeParse(text.trim());
  return checked.success
    ? { ok: true, value: checked.data }
    : { ok: false, error: checked.error.issues[0]?.message ?? 'Use a language tag.' };
}

/** A captions file as a transcript, or null when it has no text. */
async function captionsAsTranscript(fileId: string) {
  const url = mediaUrl({ kind: 'file', fileId });
  const response = url ? await fetch(url) : undefined;
  if (!response?.ok) throw new Error("The captions file couldn't be loaded.");
  const paragraphs = vttToTranscript(await response.text());
  return paragraphs.length > 0 ? transcriptToRichText(paragraphs) : null;
}

type Note = { text: string; error?: boolean };

/** A video's captions files (WebVTT): add, set the language and name, remove, or use one as the transcript. */
export function CaptionsEditor({
  block,
  onChange,
  course,
}: Pick<EditorProps<VideoBlock>, 'block' | 'onChange' | 'course'>) {
  const captions = block.captions ?? [];
  const [note, setNote] = useState<Note>();
  const [loading, setLoading] = useState<string>();
  // The block as it is now, for when a captions file has loaded.
  const latest = useRef(block);
  useEffect(() => {
    latest.current = block;
  });
  const setCaptions = (next: Captions[]) =>
    onChange(withOptional(block, 'captions', next.length > 0 ? next : undefined));
  const update = (index: number, change: (item: Captions) => Captions) =>
    setCaptions(captions.map((item, at) => (at === index ? change(item) : item)));

  async function fillTranscript(fileId: string) {
    setLoading(fileId);
    setNote(undefined);
    try {
      const transcript = await captionsAsTranscript(fileId);
      if (!transcript) setNote({ text: 'These captions have no text to use.', error: true });
      else {
        onChange({ ...latest.current, transcript: transcript.text });
        setNote({
          text: transcript.truncated
            ? "The transcript now has the captions' text, except the end, which was too long."
            : "The transcript now has the captions' text.",
        });
      }
    } catch {
      setNote({ text: "The captions couldn't be loaded. Try again.", error: true });
    } finally {
      setLoading(undefined);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-small font-medium text-fg">Captions</legend>
      <p className="text-small text-muted">WebVTT files (.vtt), one for each language.</p>
      {captions.map((item, index) => (
        <fieldset
          key={item.fileId}
          className="flex flex-col gap-3 rounded border border-border p-3"
        >
          <legend className="text-small font-medium text-fg">Captions file {index + 1}</legend>
          <div className="flex flex-wrap items-start gap-3">
            <CheckedField
              label="Language"
              hint={'A language tag, such as "en" or "es-MX".'}
              value={item.language}
              check={checkLanguage}
              onChange={(language) => update(index, (next) => ({ ...next, language }))}
              input={{ maxLength: 35, className: 'w-40' }}
            />
            <Field label="Name in the menu" hint='Optional, such as "English".' className="grow">
              <Input
                value={item.label ?? ''}
                maxLength={LIMITS.label}
                onChange={(event) =>
                  update(index, (next) =>
                    withOptional(next, 'label', optionalText(event.target.value)),
                  )
                }
              />
            </Field>
            <IconButton
              label={`Remove captions file ${index + 1}`}
              size="sm"
              onClick={() => setCaptions(captions.filter((_, at) => at !== index))}
            >
              <Trash2 aria-hidden />
            </IconButton>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            disabled={loading !== undefined}
            onClick={() => void fillTranscript(item.fileId)}
          >
            <FileText aria-hidden />
            {loading === item.fileId ? 'Loading the captions…' : 'Use as the transcript'}
          </Button>
        </fieldset>
      ))}
      {note && (
        <p
          role={note.error ? 'alert' : 'status'}
          className={note.error ? 'text-small text-danger' : 'text-small text-muted'}
        >
          {note.text}
        </p>
      )}
      {captions.length < LIMITS.captions ? (
        <MediaPicker
          accept={CAPTIONS}
          courseId={course.id}
          label="Add captions"
          onPick={({ media }) =>
            media.kind === 'file' &&
            setCaptions([...captions, { fileId: media.fileId, language: 'en' }])
          }
        />
      ) : (
        <p className="text-small text-muted">
          This video has the most captions files ({LIMITS.captions}).
        </p>
      )}
    </fieldset>
  );
}
