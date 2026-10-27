import {
  addBankQuestion,
  BANK_LIMITS,
  duplicateBankQuestion,
  moveBankQuestion,
  removeBankQuestion,
  setBankDetails,
  updateBankQuestion,
} from '@carehub/learning';
import type { BankReply, ImportQuestionsReply, QuestionBank } from '@carehub/learning';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  Textarea,
} from '@carehub/ui';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { createAutosave } from '../data/autosave';
import type { Autosave, SaveStatus } from '../data/autosave';
import { QuestionList } from '../editors/questions/QuestionList';
import { questionCount } from './BankList';
import { BANKS_PATH, bankKeys, saveBank, useDeleteBank } from './data';
import { ImportedNotice, ImportQuestions } from './ImportQuestions';

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  offline: "You're offline. Your changes are kept here and saved when you're back.",
  conflict: 'Not saved: someone else saved this bank since you opened it.',
  error: "Couldn't save. Trying again in a moment.",
};

const NO_TITLE = 'Give the bank a title first, so your changes are saved.';

/** Why an import can't start while the latest changes aren't saved (it loads the bank again afterwards). */
const NOT_SAVED: Record<Exclude<SaveStatus, 'saved'>, string> = {
  unsaved: 'Your latest changes are still being saved. Try again in a moment.',
  saving: 'Your latest changes are still being saved. Try again in a moment.',
  offline:
    "You're offline. Import when you're back online, so your latest changes are saved first.",
  conflict: 'Someone else saved this bank since you opened it. Reload it before importing.',
  error: "Your latest changes couldn't be saved, so nothing was imported. Try again in a moment.",
};

function startAutosave(
  revision: { current: number },
  queryClient: QueryClient,
  onStatus: (status: SaveStatus) => void,
): Autosave<QuestionBank> {
  return createAutosave<QuestionBank>({
    revision: revision.current,
    save: async (bank, from) => {
      const saved = await saveBank(bank, from);
      revision.current = saved.revision;
      void queryClient.invalidateQueries({ queryKey: bankKeys.list });
      return saved;
    },
    onStatus,
  });
}

/** Saves the bank a moment after each change, one save at a time, and saves what's left when the editor closes. */
function useBankAutosave(reply: BankReply) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SaveStatus>('saved');
  const revision = useRef(reply.revision);
  const autosave = useRef<Autosave<QuestionBank> | null>(null);
  // Ready from the first render, so no change is missed; started again if the effect below runs again.
  autosave.current ??= startAutosave(revision, queryClient, setStatus);

  useEffect(() => {
    const instance = (autosave.current ??= startAutosave(revision, queryClient, setStatus));
    const warn = (event: BeforeUnloadEvent) => {
      if (instance.status !== 'saved') event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      autosave.current = null;
      void instance.flush().finally(() => instance.dispose());
    };
  }, [queryClient]);

  return { status, autosave };
}

function DeleteBank({ bank, onDeleted }: { bank: QuestionBank; onDeleted(): void }) {
  const remove = useDeleteBank();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="danger" size="sm" className="self-start">
          Delete bank
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this bank?</DialogTitle>
          <DialogDescription>
            This deletes “{bank.title.trim() || 'Untitled bank'}”
            {bank.questions.length > 0 && ` and its ${questionCount(bank.questions.length)}`}.
            Published courses keep the questions they copied. A quiz that draws from this bank
            can&apos;t be published again until the draw is changed or removed.
          </DialogDescription>
        </DialogHeader>
        {remove.isError && (
          <p role="alert" className="text-small text-danger">
            The bank couldn&apos;t be deleted. {remove.error.message}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => remove.mutate(bank.id, { onSuccess: onDeleted })}
          >
            Delete bank
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Props for {@link BankEditor}. */
export type BankEditorProps = {
  /** The bank as loaded, with the revision to save against. */
  reply: BankReply;
  /** Loads the bank again (after someone else saved it). */
  onReload(): void;
  /** What the last spreadsheet import added. The screen keeps it, as the editor starts again after an import. */
  imported: ImportQuestionsReply | null;
  /** Keeps what an import added, or forgets it (null). */
  onImported(reply: ImportQuestionsReply | null): void;
};

/**
 * Edits one question bank: title, description and up to 500 questions, saved automatically, plus the spreadsheet
 * import. A bank needs a title to be saved. When someone else saved the bank first, nothing is overwritten: the
 * editor offers to reload.
 */
export function BankEditor({ reply, onReload, imported, onImported }: BankEditorProps) {
  const id = useId();
  const navigate = useNavigate();
  const { status, autosave } = useBankAutosave(reply);
  const [bank, setBank] = useState(reply.bank);
  const latest = useRef(reply.bank);
  const untitled = bank.title.trim() === '';

  const apply = (edit: (current: QuestionBank) => QuestionBank) => {
    const next = edit(latest.current);
    if (next === latest.current) return;
    latest.current = next;
    setBank(next);
    if (next.title.trim() !== '') autosave.current?.change(next);
  };

  // The import adds to the bank on the server, which is then loaded again: save what's waiting first.
  const beforeImport = async (): Promise<string | null> => {
    if (latest.current.title.trim() === '') return NO_TITLE;
    const saved = (await autosave.current?.flush()) ?? 'saved';
    return saved === 'saved' ? null : NOT_SAVED[saved];
  };

  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
      <title>{`Care Hub · ${bank.title.trim() || 'Untitled bank'}`}</title>
      <Link
        to={BANKS_PATH}
        className="flex items-center gap-1 self-start text-small text-muted hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Question banks
      </Link>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="min-w-0 text-title text-fg">{bank.title.trim() || 'Untitled bank'}</h1>
        <p role="status" className="text-small text-muted">
          {untitled ? 'Not saved: the bank needs a title.' : STATUS_TEXT[status]}
        </p>
      </div>
      {status === 'conflict' && (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded border border-border p-4"
        >
          <p className="text-body text-fg">
            Someone else saved this bank since you opened it, so your latest changes weren&apos;t
            saved. Reload to see their version, then make your changes again.
          </p>
          <Button variant="secondary" size="sm" onClick={onReload}>
            Reload
          </Button>
        </div>
      )}
      {imported && <ImportedNotice reply={imported} onDismiss={() => onImported(null)} />}
      <Field label="Title" required error={untitled ? 'Give the bank a title.' : undefined}>
        <Input
          value={bank.title}
          maxLength={BANK_LIMITS.title}
          onChange={(event) => {
            const title = event.currentTarget.value;
            apply((current) => setBankDetails(current, { title }));
          }}
        />
      </Field>
      <Field label="Description" hint="Optional. What the questions cover.">
        <Textarea
          value={bank.description ?? ''}
          rows={3}
          maxLength={BANK_LIMITS.description}
          onChange={(event) => {
            const description = event.currentTarget.value;
            apply((current) => setBankDetails(current, { description }));
          }}
        />
      </Field>
      <section aria-labelledby={`${id}-questions`} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${id}-questions`} className="text-h3 text-fg">
            Questions
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-small text-muted">
              {bank.questions.length} of {BANK_LIMITS.questions}
            </p>
            <ImportQuestions
              bankId={bank.id}
              questionCount={bank.questions.length}
              beforeImport={beforeImport}
              onImported={onImported}
            />
          </div>
        </div>
        <QuestionList
          questions={bank.questions}
          max={BANK_LIMITS.questions}
          onAdd={(question) => apply((current) => addBankQuestion(current, question))}
          onUpdate={(id, next) => apply((current) => updateBankQuestion(current, id, next))}
          onCopy={(id) => apply((current) => duplicateBankQuestion(current, id))}
          onMove={(id, to) => apply((current) => moveBankQuestion(current, id, to))}
          onRemove={(id) => apply((current) => removeBankQuestion(current, id))}
        />
      </section>
      <DeleteBank
        bank={bank}
        onDeleted={() => {
          autosave.current?.dispose();
          void navigate(BANKS_PATH);
        }}
      />
    </main>
  );
}
