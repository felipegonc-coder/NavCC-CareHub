import { LIMITS, newId, type Course, type ProcessBlock } from '@carehub/learning';
import { Checkbox, Field, Input } from '@carehub/ui';
import { useState } from 'react';
import { ImageField } from '../../../media';
import type { EditorProps } from '../media/editor-props';
import { optionalRichText, RichTextField, withOptional } from '../media/fields';
import { ItemList } from '../media/ItemList';

type Panel = NonNullable<ProcessBlock['intro']>;

/** The process's first or last screen: on or off, then its title and optional text. */
function PanelEditor({
  legend,
  toggle,
  value,
  onChange,
  course,
}: {
  legend: string;
  toggle: string;
  value: Panel | undefined;
  onChange(next: Panel | undefined): void;
  course: Course;
}) {
  // Turned off and on again, a screen gets its words back.
  const [kept, setKept] = useState(value);
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-small font-medium text-fg">{legend}</legend>
      <Field label={toggle} layout="inline">
        <Checkbox
          checked={value !== undefined}
          onCheckedChange={(checked) => {
            if (checked === true) onChange(kept ?? { title: '' });
            else {
              setKept(value);
              onChange(undefined);
            }
          }}
        />
      </Field>
      {value && (
        <>
          <Field label={`${legend} title`}>
            <Input
              value={value.title}
              maxLength={LIMITS.title}
              onChange={(event) => onChange({ ...value, title: event.target.value })}
            />
          </Field>
          <RichTextField
            label={`${legend} text`}
            hint="Optional."
            value={value.body}
            course={course}
            onChange={(body) => onChange(withOptional(value, 'body', optionalRichText(body)))}
          />
        </>
      )}
    </fieldset>
  );
}

/** A process block: an optional introduction, its steps (each with an optional picture) and a summary. */
export function ProcessEditor({ block, onChange, course }: EditorProps<ProcessBlock>) {
  return (
    <div className="flex flex-col gap-6">
      <PanelEditor
        legend="Introduction"
        toggle="Start with an introduction"
        value={block.intro}
        course={course}
        onChange={(intro) => onChange(withOptional(block, 'intro', intro))}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-small font-medium text-fg">Steps</legend>
        <ItemList
          noun="Step"
          items={block.steps}
          max={LIMITS.processSteps}
          newItem={() => ({ id: newId(), title: '', body: [] })}
          onChange={(steps) => onChange({ ...block, steps })}
        >
          {(step, update) => (
            <>
              <Field label="Title">
                <Input
                  value={step.title}
                  maxLength={LIMITS.title}
                  onChange={(event) => update({ title: event.target.value })}
                />
              </Field>
              <RichTextField
                label="Text"
                value={step.body}
                course={course}
                onChange={(body) => update({ body })}
              />
              <ImageField
                label="Picture (optional)"
                caption={false}
                value={step.image}
                courseId={course.id}
                onChange={(image) => update({ image })}
              />
            </>
          )}
        </ItemList>
      </fieldset>
      <PanelEditor
        legend="Summary"
        toggle="End with a summary"
        value={block.summary}
        course={course}
        onChange={(summary) => onChange(withOptional(block, 'summary', summary))}
      />
    </div>
  );
}
