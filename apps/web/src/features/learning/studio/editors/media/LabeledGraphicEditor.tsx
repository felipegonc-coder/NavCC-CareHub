import { LIMITS, newId, type LabeledGraphicBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import { ImageField } from '../../../media';
import type { EditorProps } from './editor-props';
import { RichTextField } from './fields';
import { ItemList } from './ItemList';

const SIDES = [
  ['x', 'From the left (%)'],
  ['y', 'From the top (%)'],
] as const;

/** A number typed into a percent box, kept within 0–100 (empty counts as 0). */
const toPercent = (input: string) => {
  const value = Number(input);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
};

/** A labelled picture block: the picture, and spots on it with a title and a note each. */
export function LabeledGraphicEditor({
  block,
  onChange,
  course,
}: EditorProps<LabeledGraphicBlock>) {
  return (
    <div className="flex flex-col gap-5">
      <ImageField
        required
        caption={false}
        value={block.image}
        courseId={course.id}
        onChange={(image) => image && onChange({ ...block, image })}
      />
      <p className="text-small text-muted">
        Spots are placed in % of the picture, from its top-left corner.
      </p>
      <ItemList
        noun="Spot"
        items={block.markers}
        max={LIMITS.markers}
        newItem={() => ({ id: newId(), x: 50, y: 50, title: '', text: [] })}
        onChange={(markers) => onChange({ ...block, markers })}
      >
        {(marker, update) => (
          <>
            <Field label="Title">
              <Input
                value={marker.title}
                maxLength={LIMITS.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Field>
            <div className="flex flex-wrap gap-3">
              {SIDES.map(([side, label]) => (
                <Field key={side} label={label} className="w-40">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={100}
                    value={marker[side]}
                    onChange={(event) => update({ [side]: toPercent(event.target.value) })}
                  />
                </Field>
              ))}
            </div>
            <RichTextField
              label="Note"
              hint="Shown when the spot is opened."
              value={marker.text}
              course={course}
              onChange={(text) => update({ text })}
            />
          </>
        )}
      </ItemList>
    </div>
  );
}
