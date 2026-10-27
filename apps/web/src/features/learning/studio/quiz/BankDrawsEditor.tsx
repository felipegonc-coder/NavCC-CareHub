import { addBankDraw, LIMITS, removeBankDraw, setBankDrawCount } from '@carehub/learning';
import type { QuizLesson } from '@carehub/learning';
import { Button, Field, IconButton, Input, Spinner } from '@carehub/ui';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useBankList } from '../banks/data';

/** Props for {@link BankDrawsEditor}. */
export type BankDrawsEditorProps = {
  lesson: QuizLesson;
  onChange(next: QuizLesson): void;
};

const NEW_DRAW_COUNT = 5;

const plural = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`;

/**
 * The banks a quiz draws extra questions from, how many each try takes from each, and a list to add another bank
 * from (at most 10, one draw per bank). Publishing copies the banks' questions into the course.
 */
export function BankDrawsEditor({ lesson, onChange }: BankDrawsEditorProps) {
  const banks = useBankList();
  const [choosing, setChoosing] = useState(false);
  const draws = lesson.bankDraws ?? [];
  const byId = new Map((banks.data ?? []).map((bank) => [bank.id, bank]));
  const available = (banks.data ?? []).filter(
    (bank) => !draws.some((draw) => draw.bankId === bank.id),
  );
  const full = draws.length >= LIMITS.bankDraws;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-muted">
        Each try also picks questions at random from these banks. Publishing keeps a copy of the
        banks&apos; questions, so later changes to a bank reach learners when you publish again.
      </p>
      {draws.length > 0 && (
        <ul className="flex flex-col gap-2">
          {draws.map((draw) => {
            const bank = byId.get(draw.bankId);
            const name = bank?.title ?? `bank "${draw.bankId}"`;
            const hint = bank
              ? `The bank has ${plural(bank.questionCount)}.`
              : banks.isSuccess
                ? "This bank doesn't exist any more. Remove it or pick another."
                : undefined;
            return (
              <li
                key={draw.bankId}
                className="flex items-end gap-2 rounded border border-border p-3"
              >
                <Field label={`Questions per try from ${name}`} hint={hint} className="grow">
                  <Input
                    type="number"
                    min={1}
                    max={Math.min(
                      LIMITS.bankDrawCount,
                      bank?.questionCount ?? LIMITS.bankDrawCount,
                    )}
                    value={draw.count}
                    onChange={(event) =>
                      onChange(setBankDrawCount(lesson, draw.bankId, event.target.valueAsNumber))
                    }
                  />
                </Field>
                <IconButton
                  label={`Stop using ${name}`}
                  size="sm"
                  onClick={() => onChange(removeBankDraw(lesson, draw.bankId))}
                >
                  <Trash2 aria-hidden />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {banks.isPending && <Spinner label="Loading question banks" />}
      {banks.isError && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-small text-danger">
          <span>Couldn&apos;t load the question banks. {banks.error.message}</span>
          <Button variant="secondary" size="sm" onClick={() => void banks.refetch()}>
            Try again
          </Button>
        </div>
      )}
      {banks.isSuccess && banks.data.length === 0 && (
        <p className="text-small text-muted">
          There are no question banks yet. Make them under Question banks in the Studio.
        </p>
      )}
      {banks.isSuccess && banks.data.length > 0 && !choosing && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={full || available.length === 0}
            onClick={() => setChoosing(true)}
          >
            <Plus aria-hidden />
            Add questions from a bank
          </Button>
        </div>
      )}
      {choosing && (
        <div
          role="group"
          aria-label="Choose a bank"
          className="flex flex-col gap-2 rounded border border-border p-3"
        >
          <ul className="flex flex-col gap-2">
            {available.map((bank) => (
              <li key={bank.id} className="flex items-center justify-between gap-2">
                <span className="text-small text-fg">
                  {bank.title} <span className="text-muted">· {plural(bank.questionCount)}</span>
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Add ${bank.title}`}
                  onClick={() => {
                    const count = Math.max(1, Math.min(NEW_DRAW_COUNT, bank.questionCount));
                    onChange(addBankDraw(lesson, bank.id, count));
                    setChoosing(false);
                  }}
                >
                  Add
                </Button>
              </li>
            ))}
          </ul>
          <div>
            <Button variant="ghost" size="sm" onClick={() => setChoosing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
