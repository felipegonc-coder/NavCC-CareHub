// The "/button" block as people see it (spec 2 and 3.4): the button with its icon and label, a
// spinner while it runs, ✓ when it's done and "Done · Undo" for 8 seconds if it changed
// anything, and the failed step and why.
import {
  BUTTON_MESSAGES,
  BUTTON_UNDO_MS,
  type PressResponse,
} from '@carehub/extras/templates/buttons';
import {
  Button,
  buttonClasses,
  cn,
  colorClasses,
  Skeleton,
  Spinner,
  Tooltip,
  useToast,
  VisuallyHidden,
} from '@carehub/ui';
import { Check, Undo2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '../../../lib/api';
import { failureMessage } from '../template-fields';
import { useButton, useButtonsClient } from './api';
import { ConfirmDialog } from './confirm-dialog';
import { doPageSteps, type PageStepDeps, type UndoStep } from './page-steps';

/** How long ✓ shows after a run. */
export const DONE_MS = 2000;

export interface ButtonBlockProps {
  buttonId: string;
  pageId: string;
  /** The page is open for editing. */
  editable: boolean;
  /** The page has its own copy of the button now (a duplicated page): the block keeps its ID. */
  onCopied(buttonId: string): void;
  /** What the page does for Insert blocks, Open a page and Open a link. */
  steps: PageStepDeps;
}

/** A run so far: its parts before and after a confirmation add up. */
interface Run {
  runId: string;
  undo: UndoStep[];
  changed: boolean;
  skipped: number;
}

interface Undoable {
  runId: string;
  undo: UndoStep[];
  until: number;
  skipped: number;
}

type Confirm = NonNullable<PressResponse['confirm']>;

export function ButtonBlock({ buttonId, pageId, editable, onCopied, steps }: ButtonBlockProps) {
  const button = useButton(buttonId, pageId);
  const client = useButtonsClient();
  const { toast } = useToast();
  const descriptionId = useId();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [undoable, setUndoable] = useState<Undoable | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [said, setSaid] = useState('');
  const run = useRef<Run | null>(null);
  const busy = useRef(false);
  const data = button.data;

  useEffect(() => {
    if (data && data.id !== buttonId) onCopied(data.id);
  }, [data, buttonId, onCopied]);

  useEffect(() => {
    if (!done) return undefined;
    const timer = setTimeout(() => setDone(0), DONE_MS);
    return () => clearTimeout(timer);
  }, [done]);

  useEffect(() => {
    if (!undoable) return undefined;
    const timer = setTimeout(() => setUndoable(null), Math.max(0, undoable.until - Date.now()));
    return () => clearTimeout(timer);
  }, [undoable]);

  if (button.isPending) return <Skeleton className="h-8 w-32" />;
  if (!data) {
    const gone = button.error instanceof ApiError && button.error.status === 404;
    if (gone && !editable) return null;
    return (
      <p className="text-small text-muted">
        {gone ? 'This button was removed.' : 'Couldn’t load this button.'}
      </p>
    );
  }

  const { settings, canEdit, canPress } = data;
  const label = settings.label || 'Button';
  const noActions = settings.actions.length === 0;
  // "Add an action" is for people who can set it up; others only see it greyed out.
  const reason = canPress ? null : noActions && !canEdit ? null : data.reason;
  const description = [data.sentence, reason].filter(Boolean).join(' ');

  const finish = (current: Run, undoUntil: string | null, failed: boolean) => {
    run.current = null;
    if (!failed) {
      setDone(Date.now());
      setSaid(`${label}: ${BUTTON_MESSAGES.done}`);
    }
    // 8 seconds from now: the server's clock may differ from this one, and it allows a little more.
    if (current.changed && (undoUntil || current.undo.length > 0)) {
      const until = Date.now() + BUTTON_UNDO_MS;
      setUndoable({ runId: current.runId, undo: current.undo, until, skipped: current.skipped });
    }
  };

  const press = async (after?: { runId: string; from: number }) => {
    if (busy.current) return;
    busy.current = true;
    setRunning(true);
    setFailure(null);
    setUndoable(null);
    setSaid(`${label}: running`);
    try {
      const answer = await client.press(
        buttonId,
        after ? { pageId, runId: after.runId, from: after.from } : { pageId },
      );
      const page = doPageSteps(answer.pageSteps, steps);
      const before = after && run.current?.runId === answer.runId ? run.current : null;
      const current: Run = {
        runId: answer.runId,
        undo: [...page.undo, ...(before?.undo ?? [])],
        changed: Boolean(before?.changed) || answer.changed || page.changed,
        skipped: (before?.skipped ?? 0) + answer.skipped,
      };
      run.current = current;
      const failed = answer.failure ?? page.failure;
      if (failed) {
        const message = `Couldn’t finish step ${failed.step}: ${failed.message}`;
        setFailure(message);
        setSaid('');
      }
      if (answer.confirm && !failed) {
        setSaid('');
        setConfirm(answer.confirm);
        return;
      }
      finish(current, answer.undoUntil, Boolean(failed));
    } catch (error) {
      run.current = null;
      setSaid('');
      setFailure(failureMessage(error, 'Couldn’t press the button. Try again.'));
      // Who may press it, or the settings, may have changed meanwhile.
      if (error instanceof ApiError && (error.status === 403 || error.status === 409)) {
        void button.refetch();
      }
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  const cancel = async () => {
    const current = run.current;
    setConfirm(null);
    if (!current) return;
    run.current = null;
    try {
      const { undoUntil } = await client.cancel(current.runId);
      setSaid(`${label}: stopped`);
      finish(current, undoUntil, true);
    } catch (error) {
      setFailure(failureMessage(error, 'Couldn’t stop the button.'));
    }
  };

  const undo = async () => {
    const last = undoable;
    if (!last) return;
    setUndoable(null);
    let kept = 0;
    let messagesSent = 0;
    try {
      const answer = await client.undo(last.runId);
      kept += answer.kept;
      messagesSent += answer.messagesSent;
    } catch (error) {
      toast({ title: failureMessage(error, 'Couldn’t undo it.'), variant: 'danger' });
      return;
    }
    for (const step of last.undo) if (!step()) kept += 1;
    const notes = [
      kept > 0 ? BUTTON_MESSAGES.undoSkipped : '',
      messagesSent > 0 ? BUTTON_MESSAGES.undoMessages : '',
    ].filter(Boolean);
    toast({ title: 'Undone', description: notes.join(' ') || undefined });
    setSaid(`${label}: undone`);
  };

  const onClick = () => {
    if (running) return;
    if (!canPress) return;
    void press();
  };

  const colored = canPress && settings.color !== 'default';
  const main = (
    <button
      type="button"
      aria-disabled={canPress ? undefined : true}
      aria-busy={running || undefined}
      aria-describedby={description ? descriptionId : undefined}
      onClick={onClick}
      className={cn(
        buttonClasses({ variant: 'secondary', size: 'sm' }),
        colored && [colorClasses[settings.color].bg, colorClasses[settings.color].text],
        !canPress && 'cursor-not-allowed text-faint hover:border-border hover:bg-bg',
      )}
    >
      {running ? (
        <Spinner decorative />
      ) : done ? (
        <Check aria-hidden className="text-success" />
      ) : (
        settings.icon && <span aria-hidden>{settings.icon}</span>
      )}
      {label}
    </button>
  );

  return (
    <div className="group/button flex flex-col items-start gap-1 py-1">
      <div className="flex flex-wrap items-center gap-1">
        {reason ? <Tooltip content={reason}>{main}</Tooltip> : main}
        {undoable && (
          <span className="flex items-center gap-1 text-small text-muted">
            {BUTTON_MESSAGES.done}
            {undoable.skipped > 0 ? ` · ${undoable.skipped} skipped` : ''} ·
            <Button variant="ghost" size="sm" onClick={() => void undo()}>
              <Undo2 aria-hidden />
              Undo
            </Button>
          </span>
        )}
      </div>
      {failure && (
        <p role="alert" className="text-small text-danger">
          {failure}
        </p>
      )}
      {description && (
        <span id={descriptionId} hidden>
          {description}
        </span>
      )}
      <VisuallyHidden role="status">{said}</VisuallyHidden>
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.confirmLabel}
          onCancel={() => void cancel()}
          onContinue={() => {
            const current = run.current;
            setConfirm(null);
            if (current) void press({ runId: current.runId, from: confirm.from });
          }}
        />
      )}
    </div>
  );
}
