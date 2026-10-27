import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Paperclip, X } from 'lucide-react';
import type { FileRef, Id } from '@carehub/databases';
import { LIMITS } from '@carehub/databases';
import { Button, Checkbox, IconButton, Input, Switch, Textarea, cn } from '@carehub/ui';
import { isApiError, OFFLINE_MESSAGE, UNKNOWN_ERROR_MESSAGE } from '../databases/api';
import { useFormsClient } from './api';
import {
  checkedOf,
  dateOf,
  filesOf,
  idsOf,
  pickedOf,
  textOf,
  uploadingText,
  type AskedQuestion,
  type DateDraft,
  type Picked,
} from './answers';
import { Picker, type PickerOption } from './picker';
import { RichText } from './rich-text';
import { formUploadScope, toFileRef } from './uploads';

/** The id of a question's box on the fill screen (the error summary links to it). */
export const questionDomId = (propertyId: Id): string => `question-${propertyId}`;

export interface QuestionProps {
  asked: AskedQuestion;
  value: unknown;
  error: string | undefined;
  /** Changes the answer from what it is now (uploads finish one by one). */
  onUpdate(propertyId: Id, change: (previous: unknown) => unknown): void;
  /** The person left the answer: check it. */
  onLeave(propertyId: Id): void;
  /** Ctrl+Enter sends the form; Enter never does from a one-line answer. */
  onKeyDown(event: KeyboardEvent<HTMLElement>): void;
  /** How many files are still going up for this question. */
  onUploads(propertyId: Id, count: number): void;
  formId: Id;
  databaseId: Id;
}

interface Ids {
  box: string;
  label: string;
  control: string;
  description: string;
  error: string;
  describedBy: string | undefined;
}

function idsFor({ prop, question }: AskedQuestion, error: string | undefined): Ids {
  const box = questionDomId(prop.id);
  const hasDescription = question.description.some((s) => s.text.trim() !== '');
  return {
    box,
    label: `${box}-label`,
    control: `${box}-control`,
    description: `${box}-description`,
    error: `${box}-error`,
    describedBy:
      [hasDescription ? `${box}-description` : null, error ? `${box}-error` : null]
        .filter(Boolean)
        .join(' ') || undefined,
  };
}

function RequiredMark({ required }: { required: boolean }) {
  if (!required) return null;
  return (
    <span aria-hidden className="text-danger">
      {' *'}
    </span>
  );
}

/** A question's box: its label (for one control) or heading (for a group), description and error. */
function QuestionBox({
  asked,
  ids,
  error,
  labelFor,
  ownLabel = false,
  children,
}: {
  asked: AskedQuestion;
  ids: Ids;
  error: string | undefined;
  /** The control the label belongs to; absent for groups, which point at the label instead. */
  labelFor?: string;
  /** The control shows its own label (a checkbox). */
  ownLabel?: boolean;
  children: ReactNode;
}) {
  const { question, prop, label } = asked;
  const labelClass = 'text-body font-medium text-fg';
  return (
    <div
      id={ids.box}
      data-property-id={prop.id}
      className={cn(
        'flex flex-col gap-2 rounded border bg-bg p-4',
        error ? 'border-danger' : 'border-border',
      )}
    >
      {!ownLabel &&
        (labelFor ? (
          <label id={ids.label} htmlFor={labelFor} className={labelClass}>
            {label}
            <RequiredMark required={question.required} />
          </label>
        ) : (
          <span id={ids.label} className={labelClass}>
            {label}
            <RequiredMark required={question.required} />
          </span>
        ))}
      <RichText
        id={ids.description}
        value={question.description}
        className="text-small text-muted"
      />
      {children}
      {error && (
        <p id={ids.error} className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT_TYPES = {
  short: { type: 'text', inputMode: undefined, autoComplete: undefined },
  number: { type: 'text', inputMode: 'decimal', autoComplete: 'off' },
  link: { type: 'url', inputMode: 'url', autoComplete: 'url' },
  email: { type: 'email', inputMode: 'email', autoComplete: 'email' },
  phone: { type: 'tel', inputMode: 'tel', autoComplete: 'tel' },
} as const;

/** One question on the fill screen, drawn for its kind. */
export function Question(props: QuestionProps) {
  const { asked, value, error, onUpdate, onLeave, onKeyDown } = props;
  const { question, prop, kind } = asked;
  const ids = idsFor(asked, error);
  const set = (next: unknown) => onUpdate(prop.id, () => next);
  const leave = () => onLeave(prop.id);
  const invalid = error ? true : undefined;

  switch (kind) {
    case 'short':
    case 'number':
    case 'link':
    case 'email':
    case 'phone': {
      const t = INPUT_TYPES[kind];
      return (
        <QuestionBox asked={asked} ids={ids} error={error} labelFor={ids.control}>
          <Input
            id={ids.control}
            type={t.type}
            inputMode={t.inputMode}
            autoComplete={t.autoComplete}
            value={textOf(value)}
            required={question.required}
            aria-invalid={invalid}
            aria-describedby={ids.describedBy}
            onChange={(event) => set(event.target.value)}
            onBlur={leave}
            onKeyDown={onKeyDown}
          />
        </QuestionBox>
      );
    }
    case 'long':
      return (
        <QuestionBox asked={asked} ids={ids} error={error} labelFor={ids.control}>
          <Textarea
            id={ids.control}
            value={textOf(value)}
            required={question.required}
            aria-invalid={invalid}
            aria-describedby={ids.describedBy}
            onChange={(event) => set(event.target.value)}
            onBlur={leave}
            onKeyDown={onKeyDown}
          />
        </QuestionBox>
      );
    case 'radio':
    case 'checkboxes': {
      const options =
        prop.config.type === 'select' || prop.config.type === 'multi_select'
          ? prop.config.options
          : [];
      const single = kind === 'radio';
      const picked = single ? [textOf(value)] : idsOf(value);
      const toggle = (optionId: Id) =>
        single
          ? set(optionId)
          : onUpdate(prop.id, (previous) => {
              const now = idsOf(previous);
              return now.includes(optionId)
                ? now.filter((x) => x !== optionId)
                : [...now, optionId];
            });
      return (
        <QuestionBox asked={asked} ids={ids} error={error}>
          <div
            role={single ? 'radiogroup' : 'group'}
            aria-labelledby={ids.label}
            aria-describedby={ids.describedBy}
            aria-required={single && question.required ? true : undefined}
            aria-invalid={single ? invalid : undefined}
            className="flex flex-col gap-2"
          >
            {options.map((option, i) => (
              <label key={option.id} className="flex items-center gap-2 text-body text-fg">
                <input
                  id={i === 0 ? ids.control : undefined}
                  type={single ? 'radio' : 'checkbox'}
                  name={ids.control}
                  value={option.id}
                  checked={picked.includes(option.id)}
                  onChange={() => toggle(option.id)}
                  onKeyDown={onKeyDown}
                  className="size-4 shrink-0 accent-primary"
                />
                <span>{option.name}</span>
              </label>
            ))}
          </div>
        </QuestionBox>
      );
    }
    case 'dropdown':
    case 'multi_dropdown': {
      const options =
        prop.config.type === 'select' || prop.config.type === 'multi_select'
          ? prop.config.options.map((o) => ({ id: o.id, label: o.name }))
          : [];
      const multiple = kind === 'multi_dropdown';
      const pickedIds = multiple ? idsOf(value) : textOf(value) ? [textOf(value)] : [];
      const selected = pickedIds.flatMap((id) => options.filter((o) => o.id === id));
      return (
        <QuestionBox asked={asked} ids={ids} error={error} labelFor={ids.control}>
          <Picker
            id={ids.control}
            labelId={ids.label}
            describedBy={ids.describedBy}
            invalid={Boolean(error)}
            required={question.required}
            multiple={multiple}
            selected={selected}
            options={options}
            onChange={(next) => set(multiple ? next.map((o) => o.id) : (next[0]?.id ?? ''))}
            onKeyDown={onKeyDown}
            onBlur={leave}
          />
        </QuestionBox>
      );
    }
    case 'date':
      return (
        <QuestionBox asked={asked} ids={ids} error={error} labelFor={ids.control}>
          <DateControl {...props} ids={ids} />
        </QuestionBox>
      );
    case 'checkbox':
      return (
        <QuestionBox asked={asked} ids={ids} error={error} ownLabel>
          <div className="flex items-center gap-2">
            <Checkbox
              id={ids.control}
              checked={checkedOf(value)}
              onCheckedChange={(checked) => set(checked === true)}
              required={question.required}
              aria-invalid={invalid}
              aria-describedby={ids.describedBy}
              onKeyDown={onKeyDown}
            />
            <label id={ids.label} htmlFor={ids.control} className="text-body font-medium text-fg">
              {asked.label}
              <RequiredMark required={question.required} />
            </label>
          </div>
        </QuestionBox>
      );
    case 'person':
    case 'relation':
      return (
        <QuestionBox asked={asked} ids={ids} error={error} labelFor={ids.control}>
          <SearchPicker {...props} ids={ids} />
        </QuestionBox>
      );
    case 'files':
      return (
        <QuestionBox asked={asked} ids={ids} error={error} labelFor={ids.control}>
          <FilesControl {...props} ids={ids} />
        </QuestionBox>
      );
  }
}

// ---------------------------------------------------------------- date

function SwitchRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="text-small text-fg">
        {label}
      </label>
    </div>
  );
}

const DEFAULT_TIME = '09:00';

function DateControl({
  asked,
  value,
  error,
  onUpdate,
  onLeave,
  onKeyDown,
  ids,
}: QuestionProps & { ids: Ids }) {
  const { prop, question } = asked;
  const d = dateOf(value);
  const update = (change: Partial<DateDraft>) =>
    onUpdate(prop.id, (previous) => ({ ...dateOf(previous), ...change }));
  const leave = () => onLeave(prop.id);
  const canTime = prop.config.type !== 'date' || prop.config.timeFormat !== 'hidden';
  const dateClass = 'w-auto';
  const invalid = error ? true : undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={ids.control}
          type="date"
          className={dateClass}
          value={d.start}
          required={question.required}
          aria-invalid={invalid}
          aria-describedby={ids.describedBy}
          onChange={(event) => update({ start: event.target.value })}
          onBlur={leave}
          onKeyDown={onKeyDown}
        />
        {d.hasTime && (
          <Input
            type="time"
            aria-label="Time"
            className={dateClass}
            value={d.startTime}
            onChange={(event) => update({ startTime: event.target.value })}
            onBlur={leave}
            onKeyDown={onKeyDown}
          />
        )}
      </div>
      {d.hasEnd && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="End"
            className={dateClass}
            value={d.end}
            aria-invalid={invalid}
            onChange={(event) => update({ end: event.target.value })}
            onBlur={leave}
            onKeyDown={onKeyDown}
          />
          {d.hasTime && (
            <Input
              type="time"
              aria-label="End time"
              className={dateClass}
              value={d.endTime}
              onChange={(event) => update({ endTime: event.target.value })}
              onBlur={leave}
              onKeyDown={onKeyDown}
            />
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-4">
        <SwitchRow
          id={`${ids.box}-end`}
          label="End date"
          checked={d.hasEnd}
          onChange={(on) =>
            update({
              hasEnd: on,
              end: on ? d.end || d.start : '',
              endTime: on ? d.endTime || d.startTime : '',
            })
          }
        />
        {canTime && (
          <SwitchRow
            id={`${ids.box}-time`}
            label="Include time"
            checked={d.hasTime}
            onChange={(on) =>
              update({
                hasTime: on,
                startTime: on ? d.startTime || DEFAULT_TIME : '',
                endTime: on ? d.endTime || DEFAULT_TIME : '',
              })
            }
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- people and rows

/** Looks things up as the person types, a moment after they stop. */
function useSearch<T>(lookup: (q: string) => Promise<T[]>, query: string, enabled: boolean) {
  const [found, setFound] = useState<{ query: string; items: T[] } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    const timer = setTimeout(() => {
      lookup(query).then(
        (items) => {
          if (live) setFound({ query, items });
        },
        () => {
          if (live) setFound({ query, items: [] });
        },
      );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [lookup, query, enabled]);
  // Only results for what's typed now: an older list could pick the wrong row with Enter.
  const current = found !== null && found.query === query;
  return { items: current ? found.items : [], searching: enabled && !current };
}

function SearchPicker({
  asked,
  value,
  error,
  onUpdate,
  onLeave,
  onKeyDown,
  ids,
}: QuestionProps & { ids: Ids }) {
  const client = useFormsClient();
  const { prop, question } = asked;
  const [query, setQuery] = useState('');
  const config = prop.config;
  const targetDatabaseId = config.type === 'relation' ? config.targetDatabaseId : null;
  const lookup = useCallback(
    async (q: string): Promise<PickerOption[]> => {
      if (targetDatabaseId !== null) {
        const rows = await client.pickRows(targetDatabaseId, q);
        return rows.map((r) => ({ id: r.id, label: r.title || 'Untitled' }));
      }
      const people = await client.searchPeople(q);
      return people.map((p) => ({ id: p.id, label: p.name || p.email || 'Unknown' }));
    },
    [client, targetDatabaseId],
  );
  const { items, searching } = useSearch(lookup, query, true);
  const single = (config.type === 'person' || config.type === 'relation') && config.single;
  const selected = pickedOf(value);
  return (
    <Picker
      id={ids.control}
      labelId={ids.label}
      describedBy={ids.describedBy}
      invalid={Boolean(error)}
      required={question.required}
      multiple={!single}
      selected={selected}
      options={items}
      onSearch={setQuery}
      searching={searching}
      onChange={(next) =>
        onUpdate(prop.id, () => next.map((o): Picked => ({ id: o.id, label: o.label })))
      }
      onKeyDown={onKeyDown}
      onBlur={() => onLeave(prop.id)}
    />
  );
}

// ---------------------------------------------------------------- files

interface Pending {
  key: number;
  name: string;
}

function uploadProblem(error: unknown): string {
  if (!isApiError(error)) return UNKNOWN_ERROR_MESSAGE;
  return error.status === 0 ? OFFLINE_MESSAGE : error.message;
}

const formatSize = (bytes: number): string =>
  bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : bytes >= 1_000
      ? `${Math.round(bytes / 1_000)} KB`
      : `${bytes} B`;

function FilesControl({
  asked,
  value,
  error,
  onUpdate,
  onUploads,
  formId,
  ids,
}: QuestionProps & { ids: Ids }) {
  const client = useFormsClient();
  const { prop } = asked;
  const files = filesOf(value);
  const [pending, setPending] = useState<Pending[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const room = LIMITS.formFiles - files.length - pending.length;

  useEffect(() => {
    onUploads(prop.id, pending.length);
  }, [onUploads, prop.id, pending.length]);
  useEffect(() => () => onUploads(prop.id, 0), [onUploads, prop.id]);

  async function upload(file: File) {
    nextKey.current += 1;
    const key = nextKey.current;
    setPending((list) => [...list, { key, name: file.name }]);
    try {
      const saved = await client.uploadFile(file, { scope: formUploadScope(formId) });
      const ref: FileRef = toFileRef(saved);
      onUpdate(prop.id, (previous) => [...filesOf(previous), ref]);
    } catch (failure) {
      setProblem(uploadProblem(failure));
    } finally {
      setPending((list) => list.filter((p) => p.key !== key));
    }
  }

  function add(list: FileList | null) {
    const chosen = list ? Array.from(list) : [];
    if (chosen.length === 0) return;
    const taken = chosen.slice(0, Math.max(0, room));
    setProblem(taken.length < chosen.length ? 'Up to 10 files.' : null);
    for (const file of taken) void upload(file);
  }

  const remove = (fileId: Id) =>
    onUpdate(prop.id, (previous) => filesOf(previous).filter((f) => f.id !== fileId));

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        id={ids.control}
        type="file"
        multiple
        className="hidden"
        aria-describedby={ids.describedBy}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file) => (
            <li key={file.id} className="flex items-center gap-2 text-small text-fg">
              <Paperclip aria-hidden className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 truncate">{file.name}</span>
              {file.size > 0 && (
                <span className="shrink-0 text-muted">{formatSize(file.size)}</span>
              )}
              <IconButton label={`Remove ${file.name}`} size="sm" onClick={() => remove(file.id)}>
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <div aria-live="polite" className="text-small text-muted">
        {pending.length > 0 ? uploadingText(pending.length) : null}
      </div>
      <div>
        <Button
          variant="secondary"
          size="sm"
          aria-describedby={ids.describedBy}
          aria-invalid={error ? true : undefined}
          disabled={room <= 0}
          onClick={() => input.current?.click()}
        >
          Upload files
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
