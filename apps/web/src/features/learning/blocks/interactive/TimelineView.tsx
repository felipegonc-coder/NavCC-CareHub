import type { TimelineBlock } from '@carehub/learning';
import type { BlockViewProps } from '../registry';
import { RichTextView } from '../text/RichTextView';

/** A timeline block: its events in order, each with its label (such as a date or a time), title and text. */
export function TimelineView({ block, course, go }: BlockViewProps<TimelineBlock>) {
  return (
    <ol className="flex flex-col">
      {block.items.map((item, i) => (
        <li key={item.id} className="flex gap-4">
          <div aria-hidden className="flex flex-col items-center">
            <span className="mt-1.5 size-3 shrink-0 rounded-full bg-primary" />
            {i < block.items.length - 1 && <span className="w-0.5 flex-1 bg-border" />}
          </div>
          <div className="flex min-w-0 flex-col gap-1 pb-6">
            <p className="text-small font-semibold text-muted">{item.label}</p>
            <h3 className="font-semibold">{item.title}</h3>
            <RichTextView value={item.body} course={course} go={go} />
          </div>
        </li>
      ))}
    </ol>
  );
}
