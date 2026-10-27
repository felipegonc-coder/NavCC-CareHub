import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  buttonClasses,
} from '@carehub/ui';
import {
  LIMITS,
  TYPE_LABELS,
  type FormDefinition,
  type Id,
  type Property,
} from '@carehub/databases';
import { addableProperties } from '@carehub/databases/forms';
import { problemText } from './api';
import { CommitInput, NativeSelect } from './controls';
import { RichTextField } from './rich-editor';
import {
  NEW_QUESTION_TYPES,
  addQuestion,
  isNewQuestionType,
  removeQuestion,
  type NewQuestionType,
} from './definition';
import { QuestionCard, cardDomId } from './question-card';
import { dropEdge, useReorder } from './reorder';

export interface FormBuilderProps {
  def: FormDefinition;
  properties: readonly Property[];
  /** The database's name, the form title's placeholder. */
  databaseTitle: string;
  /** Saves the form; false when it can't be saved (the reason shows above the form). */
  onSave(next: FormDefinition): boolean;
  /** Moves a question; false when the move is blocked. */
  onMove(from: number, to: number): boolean;
  /**
   * "New question": makes a property and asks it, answering with the property's id (null if it
   * couldn't be asked). Null when properties can't change.
   */
  onCreate: ((name: string, type: NewQuestionType) => Promise<Id | null>) | null;
}

/**
 * Where focus goes once the saved form shows (a moved card is put back, so it loses focus). After a
 * menu choice it waits until the menu has closed, as an open menu keeps focus inside it.
 */
interface PendingFocus {
  ready(def: FormDefinition): boolean;
  target(): HTMLElement | null | undefined;
  /** True while the menu the choice came from is still open. */
  afterMenu: boolean;
}

const asks = (propertyId: Id) => (def: FormDefinition) =>
  def.questions.some((q) => q.propertyId === propertyId);

/** A card's question box. */
const questionBox = (propertyId: Id): HTMLElement | null =>
  document.getElementById(cardDomId(propertyId))?.querySelector<HTMLElement>('input') ?? null;

/**
 * The Form view for people who can edit it (Forms spec, Builder): the title, description and
 * question cards in order, "+ Add question" (an unused property or a new one) and, with no
 * questions, "Add your first question." with the list of properties.
 */
export function FormBuilder({
  def,
  properties,
  databaseTitle,
  onSave,
  onMove,
  onCreate,
}: FormBuilderProps) {
  const addRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const pendingFocus = useRef<PendingFocus | null>(null);
  const shownDef = useRef(def);
  const chosen = useRef(false);
  const [creating, setCreating] = useState(false);
  const addable = addableProperties(def, properties);
  const full = def.questions.length >= LIMITS.formQuestions;

  /** Focus goes where the last action left it, once the saved form shows and no menu is open. */
  const focusPending = () => {
    const pending = pendingFocus.current;
    if (!pending || pending.afterMenu || !pending.ready(shownDef.current)) return;
    pendingFocus.current = null;
    pending.target()?.focus();
  };

  // After every render, as the saved form may now show.
  useEffect(() => {
    shownDef.current = def;
    focusPending();
  });

  /** The menu a choice came from has closed (and doesn't put focus back on its button). */
  const menuClosed = () => {
    if (pendingFocus.current) pendingFocus.current.afterMenu = false;
    focusPending();
  };

  function saveThenFocus(next: FormDefinition, pending: PendingFocus): boolean {
    pendingFocus.current = pending;
    const saved = onSave(next);
    if (!saved) pendingFocus.current = null;
    return saved;
  }

  /** Focus goes to a new question's box once its card shows, to type the question. */
  const toNewQuestion = (propertyId: Id, afterMenu: boolean): PendingFocus => ({
    ready: () => questionBox(propertyId) !== null,
    target: () => questionBox(propertyId),
    afterMenu,
  });

  const add = (prop: Property, fromMenu: boolean) =>
    saveThenFocus(addQuestion(def, prop), toNewQuestion(prop.id, fromMenu));

  /** From the question's menu. Focus goes to the card that takes its place, or "+ Add question". */
  const remove = (propertyId: Id): boolean => {
    const at = def.questions.findIndex((q) => q.propertyId === propertyId);
    const neighbour = def.questions[at + 1] ?? def.questions[at - 1];
    return saveThenFocus(removeQuestion(def, propertyId, properties), {
      ready: (d) => !asks(propertyId)(d),
      target: () => (neighbour ? questionBox(neighbour.propertyId) : null) ?? addRef.current,
      afterMenu: true,
    });
  };

  /** Focus stays on the control that moved the card. */
  const move = (from: number, to: number, control: HTMLElement | null, fromMenu: boolean) => {
    const moving = def.questions[from];
    if (!moving) return false;
    pendingFocus.current = {
      ready: (d) => d.questions[to]?.propertyId === moving.propertyId,
      target: () => control,
      afterMenu: fromMenu,
    };
    const moved = onMove(from, to);
    if (!moved) pendingFocus.current = null;
    return moved;
  };

  // A dropped card keeps no focus: it came from the mouse.
  const reorder = useReorder(listRef, def.questions.length, (from, to) =>
    move(from, to, null, false),
  );

  const doneCreating = (propertyId: Id | null) => {
    pendingFocus.current = propertyId
      ? toNewQuestion(propertyId, false)
      : { ready: () => true, target: () => addRef.current, afterMenu: false };
    setCreating(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-2 rounded border border-border bg-bg p-4">
        <CommitInput
          aria-label="Form title"
          className="h-auto py-1 text-h2 font-semibold"
          placeholder={databaseTitle}
          maxLength={LIMITS.title}
          value={def.title}
          onCommit={(title) => onSave({ ...def, title: title.trim() || databaseTitle })}
        />
        <RichTextField
          aria-label="Form description"
          placeholder="Description"
          maxLength={LIMITS.formDescription}
          value={def.description}
          onCommit={(description) => onSave({ ...def, description })}
        />
      </div>

      {def.questions.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded border border-dashed border-border p-4">
          <p className="text-body text-fg">Add your first question.</p>
          <ul className="flex flex-wrap gap-2">
            {addable.map((prop) => (
              <li key={prop.id}>
                <Button variant="secondary" size="sm" onClick={() => add(prop, false)}>
                  {prop.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol ref={listRef} className="flex flex-col gap-3">
          {def.questions.map((question, index) => {
            const prop = properties.find((p) => p.id === question.propertyId);
            return prop ? (
              <QuestionCard
                key={question.propertyId}
                def={def}
                index={index}
                question={question}
                prop={prop}
                properties={properties}
                onSave={onSave}
                onMove={move}
                onRemove={remove}
                onMenuClosed={menuClosed}
                dragging={reorder.drag?.from === index}
                dropLine={dropEdge(reorder.drag, index, def.questions.length)}
                onDragStart={(event) => reorder.start(index, event)}
              />
            ) : null;
          })}
        </ol>
      )}

      {creating && onCreate ? (
        <NewQuestion onCreate={onCreate} onDone={doneCreating} />
      ) : (
        <div className="flex flex-col items-start gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger
              ref={addRef}
              disabled={full || (addable.length === 0 && !onCreate)}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <Plus aria-hidden />
              Add question
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              onCloseAutoFocus={(event) => {
                // The new question's box (or the "New question" form) takes focus instead.
                if (!chosen.current) return;
                chosen.current = false;
                event.preventDefault();
                menuClosed();
              }}
            >
              {addable.map((prop) => (
                <DropdownMenuItem
                  key={prop.id}
                  onSelect={() => {
                    chosen.current = add(prop, true);
                  }}
                >
                  {prop.name}
                  <span aria-hidden className="ml-auto text-label text-muted">
                    {TYPE_LABELS[prop.config.type]}
                  </span>
                </DropdownMenuItem>
              ))}
              {onCreate && addable.length > 0 && <DropdownMenuSeparator />}
              {onCreate && (
                <DropdownMenuItem
                  onSelect={() => {
                    chosen.current = true;
                    setCreating(true);
                  }}
                >
                  New question
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {full && <p className="text-small text-muted">Up to 100 questions.</p>}
        </div>
      )}
    </div>
  );
}

/** "New question": a name and a type; it becomes a new property, then a question. */
function NewQuestion({
  onCreate,
  onDone,
}: {
  onCreate(name: string, type: NewQuestionType): Promise<Id | null>;
  /** The new property's id once it's asked; null when nothing was added. */
  onDone(propertyId: Id | null): void;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<NewQuestionType>('text');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const trimmed = name.trim();

  // It opens from "+ Add question", so its name box takes focus.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      onDone(await onCreate(trimmed, type));
    } catch (error) {
      setProblem(problemText(error));
      setSaving(false);
    }
  }

  return (
    <form
      aria-label="New question"
      className="flex flex-col gap-3 rounded border border-border bg-bg p-4"
      onSubmit={(event) => void submit(event)}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={`${id}-name`} className="text-small font-medium text-fg">
            Question
          </label>
          <Input
            ref={nameRef}
            id={`${id}-name`}
            value={name}
            maxLength={LIMITS.propertyName}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-type`} className="text-small font-medium text-fg">
            Type
          </label>
          <NativeSelect
            id={`${id}-type`}
            className="w-auto"
            value={type}
            onChange={(event) => {
              if (isNewQuestionType(event.target.value)) setType(event.target.value);
            }}
          >
            {NEW_QUESTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!trimmed} loading={saving}>
          Add question
        </Button>
        <Button variant="ghost" size="sm" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
