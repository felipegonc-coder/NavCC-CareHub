import { LIMITS, newId, type FlashcardsBlock } from '@carehub/learning';
import { Field, Textarea } from '@carehub/ui';
import { ImageField } from '../../../media';
import { ItemList } from '../media/ItemList';
import type { BlockEditorProps } from '../registry';

/** A flashcards block: each card's front and back, each side with an optional picture. */
export function FlashcardsEditor({ block, onChange, course }: BlockEditorProps<FlashcardsBlock>) {
  return (
    <ItemList
      noun="Card"
      items={block.cards}
      max={LIMITS.flashcards}
      newItem={() => ({ id: newId(), front: '', back: '' })}
      onChange={(cards) => onChange({ ...block, cards })}
    >
      {(card, update) => (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Field label="Front" hint="A word, a question or a prompt.">
              <Textarea
                rows={2}
                value={card.front}
                maxLength={LIMITS.shortText}
                onChange={(event) => update({ front: event.target.value })}
              />
            </Field>
            <ImageField
              label="Front picture (optional)"
              caption={false}
              value={card.frontImage}
              courseId={course.id}
              onChange={(frontImage) => update({ frontImage })}
            />
          </div>
          <div className="flex flex-col gap-3">
            <Field label="Back" hint="The answer, or more about the front.">
              <Textarea
                rows={3}
                value={card.back}
                maxLength={LIMITS.longText}
                onChange={(event) => update({ back: event.target.value })}
              />
            </Field>
            <ImageField
              label="Back picture (optional)"
              caption={false}
              value={card.backImage}
              courseId={course.id}
              onChange={(backImage) => update({ backImage })}
            />
          </div>
        </div>
      )}
    </ItemList>
  );
}
