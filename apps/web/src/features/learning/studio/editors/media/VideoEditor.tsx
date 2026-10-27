import { LIMITS, type VideoBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import { MediaPicker } from '../../../media';
import { CaptionsEditor } from './CaptionsEditor';
import type { EditorProps } from './editor-props';
import { optionalRichText, RichTextField, withOptional } from './fields';
import { MediaStatus } from './MediaStatus';

const VIDEOS = ['video'] as const;

/** A video block: the video (an upload or a video site), its title, captions files and transcript. */
export function VideoEditor({ block, onChange, course }: EditorProps<VideoBlock>) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <MediaStatus media={block.media} use="video" />
        <MediaPicker
          accept={VIDEOS}
          allowLink
          courseId={course.id}
          label="Replace the video"
          onPick={({ media }) => onChange({ ...block, media })}
        />
      </div>
      <Field label="Title" hint="Says what the video shows, for screen readers too.">
        <Input
          value={block.title}
          maxLength={LIMITS.title}
          onChange={(event) => onChange({ ...block, title: event.target.value })}
        />
      </Field>
      {block.media.kind === 'file' ? (
        <CaptionsEditor block={block} onChange={onChange} course={course} />
      ) : (
        <p className="text-small text-muted">Videos from other sites show their own captions.</p>
      )}
      <RichTextField
        label="Transcript"
        hint="Optional. Shown under the video, for people who'd rather read."
        value={block.transcript}
        course={course}
        onChange={(text) => onChange(withOptional(block, 'transcript', optionalRichText(text)))}
      />
    </div>
  );
}
