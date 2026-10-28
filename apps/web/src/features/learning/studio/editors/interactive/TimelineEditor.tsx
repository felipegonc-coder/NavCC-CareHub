import { LIMITS, newId, type TimelineBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import { ItemList } from '../media/ItemList';
import { optionalRichText } from '../media/optional';
import { RichTextField } from '../media/RichTextField';
import type { BlockEditorProps } from '../registry';

/** A timeline block: its events in order, each with a date or time, a title and optional text. */
export function TimelineEditor({ block, onChange, course }: BlockEditorProps<TimelineBlock>) {
  return (
    <ItemList
      noun="Event"
      items={block.items}
      max={LIMITS.timelineItems}
      newItem={() => ({ id: newId(), label: '', title: '' })}
      onChange={(items) => onChange({ ...block, items })}
    >
      {(item, update) => (
        <>
          <div className="flex flex-wrap gap-3">
            <Field label="When" hint="Such as 2019, Week 2 or 9:00." className="w-48">
              <Input
                value={item.label}
                maxLength={LIMITS.title}
                onChange={(event) => update({ label: event.target.value })}
              />
            </Field>
            <Field label="Title" className="grow">
              <Input
                value={item.title}
                maxLength={LIMITS.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Field>
          </div>
          <RichTextField
            label="Text"
            hint="Optional."
            value={item.body}
            course={course}
            onChange={(body) => update({ body: optionalRichText(body) })}
          />
        </>
      )}
    </ItemList>
  );
}
