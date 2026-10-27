import type { RichText } from '@carehub/learning';
import { Button } from '@carehub/ui';
import { useId, useState } from 'react';
import { RichTextView, type RichTextViewProps } from '../text/RichTextView';

/** "Show transcript" under a video or audio block; nothing when the block has no transcript. */
export function Transcript({
  text,
  course,
  go,
}: { text: RichText | undefined } & Pick<RichTextViewProps, 'course' | 'go'>) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!text?.some((paragraph) => paragraph.runs.length > 0)) return null;
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide transcript' : 'Show transcript'}
      </Button>
      <div id={id} hidden={!open} className="rounded border border-border p-4">
        <RichTextView value={text} course={course} go={go} />
      </div>
    </div>
  );
}

/** Says plainly why media can't be played here, with its link when there is one. */
export function CantPlay({ reason, href }: { reason: string; href?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-fill p-4 text-small text-muted">
      <p>{reason}</p>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-fg underline">
          Open it in a new tab
        </a>
      )}
    </div>
  );
}
