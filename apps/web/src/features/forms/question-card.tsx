import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Ellipsis } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  buttonClasses,
} from '@carehub/ui';
import {
  LIMITS,
  TYPE_LABELS,
  fromPlainText,
  plainText,
  type FormDefinition,
  type FormQuestion,
  type Id,
  type Property,
} from '@carehub/databases';
import { questionLabel } from '@carehub/databases/forms';
import { CommitInput, CommitTextarea, SwitchField } from './controls';
import { changeLogic, changeQuestion, displaySetting, type QuestionChange } from './definition';
import { LogicEditor } from './logic-editor';

/** The card's element id, to bring focus back to a card. */
export const cardDomId = (propertyId: Id): string => `form-card-${propertyId}`;

export interface QuestionCardProps {
  def: FormDefinition;
  index: number;
  question: FormQuestion;
  prop: Property;
  properties: readonly Property[];
  onSave(next: FormDefinition): void;
  /**
   * Moves the question at `from` to `to`; false when its logic blocks the move. Focus goes back to
   * `control` once the card has moved.
   */
  onMove(from: number, to: number, control: HTMLElement | null): boolean;
  /** Removes the question; false when it can't be saved. */
  onRemove(propertyId: Id): boolean;
}

/**
 * One question in the builder: its text, description, Required, how it shows, "Show if…" (never
 * on the first question) and a menu with Move up, Move down and Remove question. Alt+↑ and Alt+↓
 * move it while focus is in the card.
 */
export function QuestionCard({
  def,
  index,
  question,
  prop,
  properties,
  onSave,
  onMove,
  onRemove,
}: QuestionCardProps) {
  const id = useId();
  const menuRef = useRef<HTMLButtonElement>(null);
  // A menu choice that moves focus itself: the menu doesn't put it back on its button.
  const chosen = useRef(false);
  const label = questionLabel(question, prop);
  const [logicOpen, setLogicOpen] = useState(question.logic !== null);
  const display = displaySetting(prop);
  const last = def.questions.length - 1;
  const change = (c: QuestionChange) => onSave(changeQuestion(def, question.propertyId, c));
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (to >= 0 && to <= last) onMove(index, to, event.currentTarget);
  };
  const moveTo = (to: number) => {
    if (onMove(index, to, menuRef.current)) chosen.current = true;
  };

  return (
    <li>
      <div
        role="group"
        aria-label={label}
        id={cardDomId(question.propertyId)}
        className="flex flex-col gap-3 rounded border border-border bg-bg p-4"
      >
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <CommitInput
              aria-label="Question"
              value={question.text}
              placeholder={prop.name}
              onCommit={(text) => change({ text })}
              onKeyDown={keys}
            />
            <p className="text-label text-muted">
              {TYPE_LABELS[prop.config.type]} · {prop.name}
            </p>
          </div>
          {question.logicChanged && (
            <span className="shrink-0 rounded bg-fill px-2 py-1 text-label text-fg">
              Logic changed
            </span>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={menuRef}
              aria-label="Question menu"
              className={buttonClasses({ variant: 'ghost', size: 'sm', icon: true })}
              onKeyDown={keys}
            >
              <Ellipsis aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (!chosen.current) return;
                chosen.current = false;
                event.preventDefault();
              }}
            >
              <DropdownMenuItem disabled={index === 0} onSelect={() => moveTo(index - 1)}>
                Move up
                <span aria-hidden className="ml-auto text-label text-muted">
                  Alt+↑
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={index === last} onSelect={() => moveTo(index + 1)}>
                Move down
                <span aria-hidden className="ml-auto text-label text-muted">
                  Alt+↓
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="danger"
                onSelect={() => {
                  chosen.current = onRemove(question.propertyId);
                }}
              >
                Remove question
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CommitTextarea
          aria-label="Description"
          placeholder="Description"
          rows={2}
          maxLength={LIMITS.formDescription}
          value={plainText(question.description)}
          onCommit={(t) => change({ description: fromPlainText(t) })}
          onKeyDown={keys}
        />
        <div className="flex flex-wrap items-center gap-4">
          <SwitchField
            id={`${id}-required`}
            label="Required"
            checked={question.required}
            onChange={(required) => change({ required })}
            onKeyDown={keys}
          />
          {display && (
            <SwitchField
              id={`${id}-display`}
              label={display.label}
              checked={question.display === display.display}
              onChange={(on) => change({ display: on ? display.display : 'default' })}
              onKeyDown={keys}
            />
          )}
          {index > 0 && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={logicOpen}
              aria-controls={`${id}-logic`}
              onClick={() => setLogicOpen((open) => !open)}
              onKeyDown={keys}
            >
              Show if…
            </Button>
          )}
        </div>
        {index > 0 && logicOpen && (
          <div id={`${id}-logic`}>
            <LogicEditor
              def={def}
              question={question}
              properties={properties}
              onChange={(logic) => onSave(changeLogic(def, question.propertyId, logic))}
            />
          </div>
        )}
      </div>
    </li>
  );
}
