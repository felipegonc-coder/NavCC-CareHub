import { LIMITS, newId, type AccordionBlock, type Course, type TabsBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import type { EditorProps } from '../media/editor-props';
import { RichTextField } from '../media/fields';
import { ItemList } from '../media/ItemList';

type Section = AccordionBlock['items'][number];

/** Sections or tabs: each a title and its text. */
function TitledSections({
  noun,
  items,
  max,
  onChange,
  course,
}: {
  noun: string;
  items: readonly Section[];
  max: number;
  onChange(next: Section[]): void;
  course: Course;
}) {
  return (
    <ItemList
      noun={noun}
      items={items}
      max={max}
      newItem={() => ({ id: newId(), title: '', body: [] })}
      onChange={onChange}
    >
      {(item, update) => (
        <>
          <Field label="Title">
            <Input
              value={item.title}
              maxLength={LIMITS.title}
              onChange={(event) => update({ title: event.target.value })}
            />
          </Field>
          <RichTextField
            label="Text"
            value={item.body}
            course={course}
            onChange={(body) => update({ body })}
          />
        </>
      )}
    </ItemList>
  );
}

/** An accordion block: sections that open one by one, each a title and its text. */
export function AccordionEditor({ block, onChange, course }: EditorProps<AccordionBlock>) {
  return (
    <TitledSections
      noun="Section"
      items={block.items}
      max={LIMITS.accordionItems}
      course={course}
      onChange={(items) => onChange({ ...block, items })}
    />
  );
}

/** A tabs block: each tab a title and its text. */
export function TabsEditor({ block, onChange, course }: EditorProps<TabsBlock>) {
  return (
    <TitledSections
      noun="Tab"
      items={block.tabs}
      max={LIMITS.tabs}
      course={course}
      onChange={(tabs) => onChange({ ...block, tabs })}
    />
  );
}
