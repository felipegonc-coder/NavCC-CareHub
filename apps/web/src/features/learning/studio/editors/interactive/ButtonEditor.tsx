import {
  ExternalIdSchema,
  LIMITS,
  LinkUrlSchema,
  linkTarget,
  type ButtonBlock,
  type ButtonTarget,
} from '@carehub/learning';
import {
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@carehub/ui';
import { useState } from 'react';
import { MediaPicker } from '../../../media';
import { ChoiceButtons, withOptionalText } from '../../fields';
import { CheckedField, type Checked } from '../media/CheckedField';
import type { BlockEditorProps } from '../registry';

type Kind = ButtonTarget['kind'];

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: 'url', label: 'A web page or email address' },
  { value: 'page', label: 'A Care Hub page' },
  { value: 'file', label: 'A file' },
  { value: 'lesson', label: 'A lesson in this course' },
];

const NOW_GOES_TO: Readonly<Record<Kind, string>> = {
  url: 'its web address',
  page: 'its Care Hub page',
  file: 'its file',
  lesson: 'its lesson',
};

const FILES = ['document'] as const;

function checkUrl(text: string): Checked<ButtonTarget> {
  const url = text.trim();
  const checked = LinkUrlSchema.safeParse(url);
  return checked.success
    ? { ok: true, value: { kind: 'url', url } }
    : { ok: false, error: 'Use a full https:// or mailto: address.' };
}

/** A Care Hub page from its address (".../p/<pageId>") or its id. */
function checkPage(text: string): Checked<ButtonTarget> {
  const input = text.trim();
  const path = /\/p\/([^/?#\s]+)/.exec(input)?.[1];
  let pageId = input;
  try {
    if (path) pageId = decodeURIComponent(path);
  } catch {
    // not a page address
  }
  return ExternalIdSchema.safeParse(pageId).success
    ? { ok: true, value: { kind: 'page', pageId } }
    : { ok: false, error: 'Paste the address of a page in Care Hub.' };
}

/** A button block: its text and description, and where it goes (a link, a page, a file or a lesson). */
export function ButtonEditor({ block, onChange, course, lessonId }: BlockEditorProps<ButtonBlock>) {
  const { target } = block;
  const [kind, setKind] = useState<Kind>(target.kind);
  const [storedKind, setStoredKind] = useState<Kind>(target.kind);
  if (target.kind !== storedKind) {
    setStoredKind(target.kind);
    setKind(target.kind);
  }
  const setTarget = (next: ButtonTarget) => onChange({ ...block, target: next });
  const goesTo = linkTarget(course, target);
  const lessons = course.lessons
    .map((lesson, index) => ({
      id: lesson.id,
      title: lesson.title.trim() || `Lesson ${index + 1}`,
    }))
    .filter((lesson) => lesson.id !== lessonId);

  return (
    <div className="flex flex-col gap-5">
      <Field label="Button text">
        <Input
          value={block.label}
          maxLength={LIMITS.buttonLabel}
          onChange={(event) => onChange({ ...block, label: event.target.value })}
        />
      </Field>
      <Field label="Description" hint="Optional. Shown above the button.">
        <Textarea
          rows={2}
          value={block.description ?? ''}
          maxLength={LIMITS.shortText}
          onChange={(event) => onChange(withOptionalText(block, 'description', event.target.value))}
        />
      </Field>
      <ChoiceButtons
        label="Goes to"
        value={kind}
        options={KINDS}
        onChange={(next) => setKind(next)}
      />
      {kind === 'url' && (
        <CheckedField
          label="Address"
          hint="Such as https://example.org/guide or mailto:help@example.org."
          value={target.kind === 'url' ? target.url : ''}
          check={checkUrl}
          onChange={setTarget}
          input={{ maxLength: LIMITS.url }}
        />
      )}
      {kind === 'page' && (
        <CheckedField
          label="Page address"
          hint="Copy it from the page in Care Hub."
          value={target.kind === 'page' ? `/p/${encodeURIComponent(target.pageId)}` : ''}
          check={checkPage}
          onChange={setTarget}
          input={{ maxLength: LIMITS.url }}
        />
      )}
      {kind === 'file' && (
        <MediaPicker
          accept={FILES}
          courseId={course.id}
          label={target.kind === 'file' ? 'Replace the file' : 'Choose a file'}
          onPick={({ media }) =>
            media.kind === 'file' && setTarget({ kind: 'file', fileId: media.fileId })
          }
        />
      )}
      {kind === 'lesson' &&
        (lessons.length > 0 ? (
          <Field label="Lesson">
            <Select
              value={target.kind === 'lesson' ? target.lessonId : ''}
              onValueChange={(id) => {
                if (target.kind !== 'lesson' || target.lessonId !== id)
                  setTarget({ kind: 'lesson', lessonId: id });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a lesson" />
              </SelectTrigger>
              <SelectContent>
                {lessons.map((lesson) => (
                  <SelectItem key={lesson.id} value={lesson.id}>
                    {lesson.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <p className="text-small text-muted">This course has no other lessons yet.</p>
        ))}
      {kind !== target.kind ? (
        <p className="text-small text-muted">
          Until you choose, the button still goes to {NOW_GOES_TO[target.kind]}.
        </p>
      ) : (
        goesTo.kind === 'broken' && (
          <p role="alert" className="text-small text-danger">
            {goesTo.reason}
          </p>
        )
      )}
    </div>
  );
}
