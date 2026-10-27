import { BANK_LIMITS } from '@carehub/learning';
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
import { ArrowLeft, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ErrorState, LoadingState } from '../states';
import { bankEditorPath, useBankList, useCreateBank } from './data';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** "1 question", "12 questions". */
export const questionCount = (count: number): string =>
  `${count} ${count === 1 ? 'question' : 'questions'}`;

function NewBankForm() {
  const navigate = useNavigate();
  const create = useCreateBank();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tried, setTried] = useState(false);
  const blank = title.trim() === '';

  return (
    <form
      className="flex flex-col gap-4"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (blank) return;
        const typed = description.trim();
        create.mutate(
          { title: title.trim(), ...(typed ? { description: typed } : {}) },
          { onSuccess: (reply) => void navigate(bankEditorPath(reply.bank.id)) },
        );
      }}
    >
      <Field label="Title" required error={tried && blank ? 'Give the bank a title.' : undefined}>
        <Input
          value={title}
          maxLength={BANK_LIMITS.title}
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </Field>
      <Field
        label="Description"
        hint="Optional. What the questions cover, so others know when to draw from it."
      >
        <Textarea
          value={description}
          rows={3}
          maxLength={BANK_LIMITS.description}
          onChange={(event) => setDescription(event.currentTarget.value)}
        />
      </Field>
      {create.isError && (
        <p role="alert" className="text-small text-danger">
          The bank couldn&apos;t be created. {create.error.message}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" loading={create.isPending}>
          Create bank
        </Button>
      </DialogFooter>
    </form>
  );
}

/** New bank: a dialog for the title and description; the new bank opens in the editor. */
export function NewBankButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New bank
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New question bank</DialogTitle>
          <DialogDescription>
            You add the questions next, or import them from a spreadsheet.
          </DialogDescription>
        </DialogHeader>
        <NewBankForm />
      </DialogContent>
    </Dialog>
  );
}

/** `/learning/studio/banks`: the workspace's question banks, with New bank. */
export function BankList() {
  const banks = useBankList();
  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
      <title>Care Hub · Question banks</title>
      <Link
        to="/learning/studio"
        className="flex items-center gap-1 self-start text-small text-muted hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Studio
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="text-title text-fg">Question banks</h1>
          <p className="text-body text-muted">
            Quizzes in any course can draw questions from a bank. A course copies the questions when
            it&apos;s published, so changes here reach it the next time it&apos;s published.
          </p>
        </div>
        <NewBankButton />
      </div>
      {banks.isPending ? (
        <LoadingState label="Loading question banks" />
      ) : banks.isError ? (
        <ErrorState error={banks.error} onRetry={() => void banks.refetch()} />
      ) : banks.data.length === 0 ? (
        <p className="text-body text-muted">No question banks yet. Start one with New bank.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {banks.data.map((bank) => (
            <li key={bank.id} className="flex flex-col gap-1 rounded border border-border p-4">
              <Link
                to={bankEditorPath(bank.id)}
                className="self-start text-body font-semibold text-fg hover:underline"
              >
                {bank.title}
              </Link>
              {bank.description && (
                <p className="line-clamp-2 text-small text-muted">{bank.description}</p>
              )}
              <p className="text-small text-muted">
                {questionCount(bank.questionCount)} · Edited{' '}
                {dateFormat.format(new Date(bank.updatedAt))}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
