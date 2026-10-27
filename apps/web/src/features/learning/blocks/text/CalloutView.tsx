import type { CalloutBlock } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { CircleCheck, Info, Lightbulb, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { BlockViewProps } from '../registry';
import { RichTextView } from './RichTextView';

const TONES: Readonly<
  Record<CalloutBlock['tone'], { label: string; Icon: LucideIcon; border: string; icon: string }>
> = {
  note: { label: 'Note', Icon: Info, border: 'border-l-muted', icon: 'text-muted' },
  tip: { label: 'Tip', Icon: Lightbulb, border: 'border-l-primary', icon: 'text-primary' },
  warning: {
    label: 'Warning',
    Icon: TriangleAlert,
    border: 'border-l-warning',
    icon: 'text-warning',
  },
  success: {
    label: 'Success',
    Icon: CircleCheck,
    border: 'border-l-success',
    icon: 'text-success',
  },
};

/** A note, tip, warning or success box; screen readers hear its kind and title first. */
export function CalloutView({ block, course, go }: BlockViewProps<CalloutBlock>) {
  const tone = TONES[block.tone];
  return (
    <div
      role="note"
      aria-label={block.title ? `${tone.label}: ${block.title}` : tone.label}
      className={cn('flex gap-3 rounded border border-l-4 border-border bg-fill p-4', tone.border)}
    >
      <tone.Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', tone.icon)} />
      <div className="min-w-0 flex-1 space-y-1">
        {block.title && <p className="font-semibold text-fg">{block.title}</p>}
        <RichTextView value={block.text} course={course} go={go} />
      </div>
    </div>
  );
}
