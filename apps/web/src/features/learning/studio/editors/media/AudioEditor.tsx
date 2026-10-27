import { LIMITS, type AudioBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import { MediaPicker } from '../../../media';
import type { BlockEditorProps } from '../registry';
import { MediaStatus } from './MediaStatus';
import { optionalRichText, withOptional } from './optional';
import { RichTextField } from './RichTextField';

const AUDIO = ['audio'] as const;

/** An audio block: the uploaded audio file, its title and its transcript. */
export function AudioEditor({ block, onChange, course }: BlockEditorProps<AudioBlock>) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <MediaStatus media={block.media} use="audio" />
        <MediaPicker
          accept={AUDIO}
          courseId={course.id}
          label="Replace the audio file"
          onPick={({ media }) => onChange({ ...block, media })}
        />
      </div>
      <Field label="Title" hint="Says what the recording is, for screen readers too.">
        <Input
          value={block.title}
          maxLength={LIMITS.title}
          onChange={(event) => onChange({ ...block, title: event.target.value })}
        />
      </Field>
      <RichTextField
        label="Transcript"
        hint="Shown under the player, for people who can't listen."
        value={block.transcript}
        course={course}
        onChange={(text) => onChange(withOptional(block, 'transcript', optionalRichText(text)))}
      />
    </div>
  );
}
