import type { AccordionBlock, Id } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import type { BlockViewProps } from '../registry';
import { RichTextView } from '../text/RichTextView';

/** An accordion block: each title is a button that shows or hides its text. Several can be open at once. */
export function AccordionView({ block, course, go }: BlockViewProps<AccordionBlock>) {
  const baseId = useId();
  const [open, setOpen] = useState<ReadonlySet<Id>>(() => new Set());
  const toggle = (id: Id) =>
    setOpen((before) => {
      const next = new Set(before);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="divide-y divide-border rounded border border-border">
      {block.items.map((item, i) => {
        const expanded = open.has(item.id);
        const panelId = `${baseId}-${i}`;
        return (
          <div key={item.id}>
            <h3>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggle(item.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-semibold hover:bg-fill-hover"
              >
                {item.title}
                <ChevronDown
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 text-muted transition-transform',
                    expanded && 'rotate-180',
                  )}
                />
              </button>
            </h3>
            <div id={panelId} hidden={!expanded} className="px-4 pb-4">
              <RichTextView value={item.body} course={course} go={go} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
