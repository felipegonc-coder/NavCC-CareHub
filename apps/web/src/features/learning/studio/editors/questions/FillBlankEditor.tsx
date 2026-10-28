import { addFillPart, LIMITS, removeFillPart, setFillText, updateBlank } from '@carehub/learning';
import type { FillPart, Question } from '@carehub/learning';
import { Checkbox, Field, Input, Textarea } from '@carehub/ui';
import { AddButton, ItemActions } from './ItemActions';

/** Props for {@link FillBlankEditor}. */
export type FillBlankEditorProps = {
  question: Extract<Question, { type: 'fill_blank' }>;
  onChange(next: Question): void;
};

function moved(parts: FillPart[], from: number, to: number): FillPart[] {
  const next = [...parts];
  const [part] = next.splice(from, 1);
  if (part) next.splice(to, 0, part);
  return next;
}

/** A fill-in-the-blank sentence, built from pieces of text and blanks, each with its accepted answers. */
export function FillBlankEditor({ question, onChange }: FillBlankEditorProps) {
  const { parts } = question;
  const count = { text: 0, blank: 0 };
  const blanks = parts.filter((part) => part.kind === 'blank').length;
  const preview = parts.map((part) => (part.kind === 'text' ? part.text : '_____')).join('');
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-muted">
        Build the sentence from text and blanks. People type the missing words.
      </p>
      <ol className="flex flex-col gap-2">
        {parts.map((part, index) => {
          const n = ++count[part.kind];
          const actions = (
            <ItemActions
              name={part.kind === 'text' ? `text ${n}` : `blank ${n}`}
              index={index}
              count={parts.length}
              canRemove={part.kind === 'text' || blanks > 1}
              onMove={(to) => onChange({ ...question, parts: moved(parts, index, to) })}
              onRemove={() => onChange(removeFillPart(question, index))}
            />
          );
          if (part.kind === 'text') {
            return (
              <li key={`text-${index}`} className="flex items-end gap-2">
                <Field label={`Text ${n}`} className="grow">
                  <Input
                    value={part.text}
                    maxLength={LIMITS.longText}
                    onChange={(event) => onChange(setFillText(question, index, event.target.value))}
                  />
                </Field>
                {actions}
              </li>
            );
          }
          return (
            <li key={part.id} className="flex flex-col gap-2 rounded border border-border p-3">
              <div className="flex items-start gap-2">
                <Field label={`Blank ${n}: accepted answers`} hint="One per line." className="grow">
                  <Textarea
                    value={part.answers.join('\n')}
                    onChange={(event) =>
                      onChange(
                        updateBlank(question, part.id, { answers: event.target.value.split('\n') }),
                      )
                    }
                  />
                </Field>
                {actions}
              </div>
              <Field layout="inline" label={`Blank ${n}: capitals must match`}>
                <Checkbox
                  checked={part.caseSensitive === true}
                  onCheckedChange={(checked) =>
                    onChange(updateBlank(question, part.id, { caseSensitive: checked === true }))
                  }
                />
              </Field>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        {(['text', 'blank'] as const).map((kind) => (
          <AddButton
            key={kind}
            full={parts.length >= LIMITS.fillParts}
            onAdd={() => onChange(addFillPart(question, kind))}
          >
            {kind === 'text' ? 'Add text' : 'Add blank'}
          </AddButton>
        ))}
      </div>
      <p className="text-small text-muted">Preview: {preview}</p>
    </div>
  );
}
