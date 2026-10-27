import { LIMITS, type FileBlock } from '@carehub/learning';
import { Field, Input, Textarea } from '@carehub/ui';
import { MediaPicker } from '../../../media';
import type { EditorProps } from './editor-props';
import { optionalText, withOptional } from './fields';

const DOCUMENTS = ['document'] as const;

/** A file block: the uploaded document, the name learners see and an optional description. */
export function FileEditor({ block, onChange, course }: EditorProps<FileBlock>) {
  return (
    <div className="flex flex-col gap-5">
      <MediaPicker
        accept={DOCUMENTS}
        courseId={course.id}
        label="Replace the file"
        onPick={({ media, name }) =>
          media.kind === 'file' && onChange({ ...block, fileId: media.fileId, name })
        }
      />
      <Field label="Name" hint="Shown on the download link.">
        <Input
          value={block.name}
          maxLength={LIMITS.title}
          onChange={(event) => onChange({ ...block, name: event.target.value })}
        />
      </Field>
      <Field label="Description" hint="Optional. What's in the file, or when to use it.">
        <Textarea
          rows={2}
          value={block.description ?? ''}
          maxLength={LIMITS.shortText}
          onChange={(event) =>
            onChange(withOptional(block, 'description', optionalText(event.target.value)))
          }
        />
      </Field>
    </div>
  );
}
