import type { Id, ListBlock } from '@carehub/learning';
import { Checkbox, cn } from '@carehub/ui';
import { useId, useState } from 'react';
import type { BlockViewProps } from '../registry';
import { RichTextView } from './RichTextView';

/** A bulleted, numbered or checkbox list. */
export function ListView({ block, course, go }: BlockViewProps<ListBlock>) {
  if (block.style === 'checkbox') return <Checklist block={block} course={course} go={go} />;
  const List = block.style === 'numbered' ? 'ol' : 'ul';
  return (
    <List
      className={cn('space-y-2 pl-6', block.style === 'numbered' ? 'list-decimal' : 'list-disc')}
    >
      {block.items.map((item) => (
        <li key={item.id} className="pl-1">
          <RichTextView value={item.text} course={course} go={go} />
        </li>
      ))}
    </List>
  );
}

/** A checklist learners can tick while they read. The ticks are theirs for this visit only. */
function Checklist({
  block,
  course,
  go,
}: Pick<BlockViewProps<ListBlock>, 'block' | 'course' | 'go'>) {
  const id = useId();
  const [ticked, setTicked] = useState<ReadonlySet<Id>>(() => new Set());
  const tick = (itemId: Id, on: boolean) =>
    setTicked((current) => {
      const next = new Set(current);
      if (on) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  return (
    <ul className="space-y-2">
      {block.items.map((item) => {
        const textId = `${id}-${item.id}`;
        const on = ticked.has(item.id);
        return (
          <li key={item.id} className="flex items-start gap-3">
            <Checkbox
              aria-labelledby={textId}
              checked={on}
              onCheckedChange={(checked) => tick(item.id, checked === true)}
              className="mt-1"
            />
            <div id={textId} className={cn('min-w-0 flex-1', on && 'text-muted line-through')}>
              <RichTextView value={item.text} course={course} go={go} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
