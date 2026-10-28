import { LIMITS } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { Button, Field, Input } from '@carehub/ui';
import { useEffect, useRef, useState } from 'react';
import type { SaveStatus as Status } from '../data/autosave';
import type { DraftSaving } from './use-autosave';

/** A title box that can be cleared while typing; a blank title isn't kept (the edit ignores it). */
export function TitleField(props: { label: string; value: string; onChange(title: string): void }) {
  const [text, setText] = useState(props.value);
  const [shown, setShown] = useState(props.value);
  if (props.value !== shown) {
    setShown(props.value);
    setText(props.value);
  }
  return (
    <Field label={props.label} error={text.trim() ? undefined : 'Add a title.'}>
      <Input
        value={text}
        maxLength={LIMITS.title}
        onChange={(event) => {
          setText(event.target.value);
          props.onChange(event.target.value);
        }}
      />
    </Field>
  );
}

/** A whole number box (a spin button) that can be cleared while typing; blank means "not set" (null). */
export function NumberField(props: {
  label: string;
  hint?: string | undefined;
  value: number | undefined;
  min: number;
  max: number;
  onChange(next: number | null): void;
}) {
  const show = (value: number | undefined) => (value === undefined ? '' : String(value));
  const [text, setText] = useState(show(props.value));
  const [unreadable, setUnreadable] = useState(false);
  const [shown, setShown] = useState(props.value);
  if (props.value !== shown) {
    setShown(props.value);
    setText(show(props.value));
  }
  const valid = (raw: string) => {
    const n = Number(raw);
    return Number.isInteger(n) && n >= props.min && n <= props.max;
  };
  const typed = text.trim();
  return (
    <Field
      label={props.label}
      hint={props.hint}
      error={
        !unreadable && (typed === '' || valid(typed))
          ? undefined
          : `Use a whole number from ${props.min} to ${props.max}.`
      }
    >
      <Input
        type="number"
        min={props.min}
        max={props.max}
        step={1}
        className="max-w-32"
        value={text}
        onChange={(event) => {
          const raw = event.currentTarget.value.trim();
          const bad = event.currentTarget.validity.badInput;
          setText(event.currentTarget.value);
          setUnreadable(bad);
          if (bad) return;
          if (raw === '') props.onChange(null);
          else if (valid(raw)) props.onChange(Number(raw));
        }}
      />
    </Field>
  );
}

/** "Deleted …" with Undo. Focus moves to Undo, so keyboard users can take it straight back. */
export function UndoNotice({ message, onUndo }: { message: string; onUndo(): void }) {
  const undo = useRef<HTMLButtonElement>(null);
  useEffect(() => undo.current?.focus(), []);
  return (
    <div role="status" className="flex items-center gap-2 rounded border border-border bg-fill p-2">
      <span className="flex-1 text-small text-fg">{message}</span>
      <Button ref={undo} size="sm" variant="secondary" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}

const STATUS_TEXT: Record<Status, string> = {
  saved: 'Saved',
  unsaved: 'Saving…',
  saving: 'Saving…',
  offline: "You're offline. Changes are kept here and saved when you're back.",
  error: "Couldn't save. Trying again soon.",
  conflict: 'Someone else saved this course after you opened it.',
};

/** Where the draft stands next to the title; after a conflict, keep this version or load theirs. */
export function SaveState({
  saving,
  onLoad,
}: {
  saving: DraftSaving;
  onLoad(course: Course): void;
}) {
  const [failed, setFailed] = useState(false);
  const run = (action: () => Promise<void>) => {
    setFailed(false);
    action().catch(() => setFailed(true));
  };
  const problem =
    saving.status === 'offline' || saving.status === 'error' || saving.status === 'conflict';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p role={problem ? 'alert' : undefined} className="text-small text-muted">
        {STATUS_TEXT[saving.status]}
      </p>
      {saving.status === 'conflict' && (
        <>
          <Button size="sm" variant="secondary" onClick={() => run(saving.keepMine)}>
            Keep my version
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => run(async () => onLoad(await saving.reload()))}
          >
            Load their version
          </Button>
        </>
      )}
      {failed && (
        <p role="alert" className="text-small text-danger">
          That didn't work. Check your connection and try again.
        </p>
      )}
    </div>
  );
}
