import {
  addQuestionItem,
  LIMITS,
  moveQuestionItem,
  QUESTION_LIST_SIZES,
  removeQuestionItem,
  setQuestionImage,
  updateQuestionItem,
} from '@carehub/learning';
import type { HotspotSpot, Question } from '@carehub/learning';
import { Checkbox, Field, Input } from '@carehub/ui';
import { AddButton, ItemActions } from './ItemActions';

type Hotspot = Extract<Question, { type: 'hotspot' }>;

/** Props for {@link HotspotEditor}. */
export type HotspotEditorProps = { question: Hotspot; onChange(next: Question): void };

const SIDES = [
  ['x', 'From the left (%)'],
  ['y', 'From the top (%)'],
  ['width', 'Width (%)'],
  ['height', 'Height (%)'],
] as const;

/** A click-the-right-spot question: the picture's description and the areas on it, right or not. */
export function HotspotEditor({ question, onChange }: HotspotEditorProps) {
  const { spots, image } = question;
  const { min, max } = QUESTION_LIST_SIZES.spots;
  const update = (spot: HotspotSpot, patch: Partial<Omit<HotspotSpot, 'id'>>) =>
    onChange(updateQuestionItem(question, 'spots', spot.id, patch));
  return (
    <div className="flex flex-col gap-3">
      <Field label="Picture description" hint="Read out to people who can't see the picture.">
        <Input
          value={image.alt}
          maxLength={LIMITS.shortText}
          onChange={(event) =>
            onChange(setQuestionImage(question, { ...image, alt: event.target.value }))
          }
        />
      </Field>
      <p className="text-small text-muted">
        Areas are measured in % of the picture, from its top-left corner.
      </p>
      <ol className="flex flex-col gap-3">
        {spots.map((spot, index) => (
          <li key={spot.id} className="flex flex-col gap-2 rounded border border-border p-3">
            <div className="flex items-end gap-2">
              <Field
                label={`Area ${index + 1} name`}
                hint="For keyboard and screen-reader users."
                className="grow"
              >
                <Input
                  value={spot.label}
                  maxLength={LIMITS.title}
                  onChange={(event) => update(spot, { label: event.target.value })}
                />
              </Field>
              <ItemActions
                name={`area ${index + 1}`}
                index={index}
                count={spots.length}
                canRemove={spots.length > min}
                onMove={(to) => onChange(moveQuestionItem(question, 'spots', spot.id, to))}
                onRemove={() => onChange(removeQuestionItem(question, 'spots', spot.id))}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {SIDES.map(([side, label]) => (
                <Field key={side} label={`Area ${index + 1}: ${label}`}>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={spot[side]}
                    onChange={(event) => update(spot, { [side]: event.target.valueAsNumber })}
                  />
                </Field>
              ))}
            </div>
            <div className="flex flex-wrap gap-4">
              <Field layout="inline" label={`Area ${index + 1} is right`}>
                <Checkbox
                  checked={spot.correct}
                  onCheckedChange={(checked) => update(spot, { correct: checked === true })}
                />
              </Field>
              <Field layout="inline" label={`Area ${index + 1} is an oval`}>
                <Checkbox
                  checked={spot.shape === 'ellipse'}
                  onCheckedChange={(checked) =>
                    update(spot, { shape: checked === true ? 'ellipse' : 'rect' })
                  }
                />
              </Field>
            </div>
          </li>
        ))}
      </ol>
      <div>
        <AddButton
          full={spots.length >= max}
          onAdd={() => onChange(addQuestionItem(question, 'spots'))}
        >
          Add area
        </AddButton>
      </div>
    </div>
  );
}
