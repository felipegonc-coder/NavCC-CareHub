import {
  addQuestionItem,
  LIMITS,
  moveQuestionItem,
  QUESTION_LIST_SIZES,
  removeQuestionItem,
  updateQuestionItem,
} from '@carehub/learning';
import type { Question } from '@carehub/learning';
import { Input } from '@carehub/ui';
import { AddButton, ItemActions } from './ItemActions';

const LISTS = {
  pairs: {
    what: 'pair',
    hint: 'People see the matches shuffled and match each one to its item.',
    fields: [
      ['prompt', 'Item'],
      ['match', 'Match for item'],
    ],
  },
  items: {
    what: 'step',
    hint: 'List the steps in the right order. People see them shuffled.',
    fields: [['text', 'Step']],
  },
} as const;

/** Props for {@link ListEditor}. */
export type ListEditorProps = {
  question: Extract<Question, { type: 'matching' | 'drag_matching' | 'ordering' }>;
  onChange(next: Question): void;
};

/** The pairs of a matching question (each item and its match), or the steps of a put-in-order question. */
export function ListEditor({ question, onChange }: ListEditorProps) {
  const list = question.type === 'ordering' ? 'items' : 'pairs';
  const rows: readonly Readonly<Record<string, string> & { id: string }>[] =
    question.type === 'ordering' ? question.items : question.pairs;
  const { what, hint, fields } = LISTS[list];
  const { min, max } = QUESTION_LIST_SIZES[list];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-muted">{hint}</p>
      <ol className="flex flex-col gap-2">
        {rows.map((row, index) => (
          <li key={row.id} className="flex items-center gap-2">
            {fields.map(([key, label]) => (
              <Input
                key={key}
                aria-label={`${label} ${index + 1}`}
                value={row[key]}
                maxLength={LIMITS.shortText}
                onChange={(event) =>
                  onChange(
                    updateQuestionItem(question, list, row.id, { [key]: event.target.value }),
                  )
                }
              />
            ))}
            <ItemActions
              name={`${what} ${index + 1}`}
              index={index}
              count={rows.length}
              canRemove={rows.length > min}
              onMove={(to) => onChange(moveQuestionItem(question, list, row.id, to))}
              onRemove={() => onChange(removeQuestionItem(question, list, row.id))}
            />
          </li>
        ))}
      </ol>
      <div>
        <AddButton
          full={rows.length >= max}
          onAdd={() => onChange(addQuestionItem(question, list))}
        >
          Add {what}
        </AddButton>
      </div>
    </div>
  );
}
