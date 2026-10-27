import {
  BANK_LIMITS,
  parseQuestionCsv,
  QUESTION_CSV_COLUMNS,
  QUESTION_CSV_MAX_CHARACTERS,
  questionCsvTemplate,
} from '@carehub/learning';
import type {
  Id,
  ImportQuestionsReply,
  QuestionCsvError,
  QuestionCsvResult,
} from '@carehub/learning';
import {
  Button,
  buttonClasses,
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
} from '@carehub/ui';
import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { questionCount } from './BankList';
import { useImportQuestions } from './data';

// The spreadsheet import (POST /studio/banks/:id/import). The file is read and checked here first, so authors
// see what will go in and what to fix before anything changes; the server reads the same text again.

/** How many row problems a list shows before "…and N more". */
const SHOWN_PROBLEMS = 20;

const templateLink = (separator: ',' | ';') =>
  `data:text/csv;charset=utf-8,${encodeURIComponent(questionCsvTemplate({ separator }))}`;

const rowCount = (count: number) => `${count} ${count === 1 ? 'row' : 'rows'}`;

const problemText = (error: QuestionCsvError) =>
  `Row ${error.row}${error.column ? `, ${error.column}` : ''}: ${error.message}`;

/** Props for {@link RowProblems}. */
export type RowProblemsProps = {
  /** The problems, in sheet order. */
  errors: readonly QuestionCsvError[];
  /** Says what happens to those rows, given how many there are. */
  lead(rows: string): string;
};

/** The first problems an import found, each with its sheet row and column. */
export function RowProblems({ errors, lead }: RowProblemsProps) {
  const shown = errors.slice(0, SHOWN_PROBLEMS);
  return (
    <div className="flex flex-col gap-1">
      <p className="text-small text-fg">
        {lead(rowCount(new Set(errors.map((error) => error.row)).size))}
      </p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-muted">
        {shown.map((error, index) => (
          <li key={index}>{problemText(error)}</li>
        ))}
      </ul>
      {errors.length > shown.length && (
        <p className="text-small text-muted">…and {errors.length - shown.length} more.</p>
      )}
    </div>
  );
}

/** Props for {@link ImportedNotice}. */
export type ImportedNoticeProps = {
  /** The server's reply to the import. */
  reply: ImportQuestionsReply;
  /** Hides the notice. */
  onDismiss(): void;
};

/** What the last import added to the bank, and the rows it left out. */
export function ImportedNotice({ reply, onDismiss }: ImportedNoticeProps) {
  return (
    <div role="status" className="flex flex-col items-start gap-3 rounded border border-border p-4">
      <p className="text-body text-fg">
        {reply.added === 0
          ? 'No questions were added from the spreadsheet.'
          : `Added ${questionCount(reply.added)} from the spreadsheet, at the end of the bank.`}
      </p>
      {reply.errors.length > 0 && (
        <RowProblems
          errors={reply.errors}
          lead={(rows) =>
            `Left out: ${rows}. Fix these in the spreadsheet, then import just those rows:`
          }
        />
      )}
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </div>
  );
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'));
    reader.readAsText(file);
  });
}

type Chosen = { text: string; read: QuestionCsvResult };

function Preview({ chosen, room }: { chosen: Chosen; room: number }) {
  const ready = chosen.read.questions.length;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-body text-fg">
        {ready === 0 ? 'No questions are ready to add.' : `${questionCount(ready)} ready to add.`}
      </p>
      {ready > room && (
        <p className="text-small text-muted">
          {room === 0
            ? `The bank is full (it holds at most ${BANK_LIMITS.questions} questions). Remove some first.`
            : room === 1
              ? 'The bank has room for 1 more question, so only the first one will be added.'
              : `The bank has room for ${room} more questions, so only the first ${room} will be added.`}
        </p>
      )}
      {chosen.text.includes('\uFFFD') && (
        <p className="text-small text-danger">
          Some characters couldn&apos;t be read and show as �. Save the spreadsheet as “CSV UTF-8”,
          then choose it again.
        </p>
      )}
      {chosen.read.errors.length > 0 && (
        <RowProblems
          errors={chosen.read.errors}
          lead={(rows) => `${rows} will be left out until fixed:`}
        />
      )}
    </div>
  );
}

/** Props for {@link ImportQuestions}. */
export type ImportQuestionsProps = {
  /** The bank the questions go into. */
  bankId: Id;
  /** How many questions the bank holds now. */
  questionCount: number;
  /**
   * Runs just before the import, to save changes still waiting (the bank is loaded again afterwards). Returns why
   * the import can't start, or null when it can.
   */
  beforeImport(): Promise<string | null>;
  /** Gets the server's reply once the questions are in and the bank is loaded again. */
  onImported(reply: ImportQuestionsReply): void;
};

/**
 * "Import from a spreadsheet": a dialog with the template, a guide to its columns and a file picker. Shows what a
 * chosen file holds (questions ready, rows with problems) before anything is added to the bank.
 */
export function ImportQuestions({
  bankId,
  questionCount: count,
  beforeImport,
  onImported,
}: ImportQuestionsProps) {
  const importQuestions = useImportQuestions(bankId);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const picks = useRef(0);
  const room = Math.max(0, BANK_LIMITS.questions - count);
  const adding = chosen ? Math.min(chosen.read.questions.length, room) : 0;

  const choose = async (file: File | undefined) => {
    const pick = (picks.current += 1);
    setChosen(null);
    setProblem(null);
    if (!file) return;
    // Text takes at most 4 bytes a character, so a bigger file is too long without reading it.
    if (file.size > 4 * QUESTION_CSV_MAX_CHARACTERS) {
      setProblem('This file is too big. Import at most about 2 MB at a time.');
      return;
    }
    try {
      const text = await readText(file);
      if (pick === picks.current) setChosen({ text, read: parseQuestionCsv(text) });
    } catch {
      if (pick === picks.current) setProblem("The file couldn't be read. Choose it again.");
    }
  };

  const start = async () => {
    if (!chosen) return;
    setBusy(true);
    setProblem(null);
    try {
      const stop = await beforeImport();
      if (stop) {
        setProblem(stop);
        return;
      }
      const reply = await importQuestions.mutateAsync(chosen.text);
      setOpen(false);
      onImported(reply);
    } catch (error) {
      setProblem(
        `The questions couldn't be imported. ${error instanceof Error ? error.message : ''}`.trim(),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        setOpen(next);
        if (!next) {
          picks.current += 1;
          setChosen(null);
          setProblem(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Upload aria-hidden />
          Import from a spreadsheet
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import questions from a spreadsheet</DialogTitle>
          <DialogDescription>
            One question per row, saved as a CSV file. The questions go at the end of this bank.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-small text-fg">
            Start from the template: it has the columns and an example of each question type.
          </p>
          <div className="flex flex-wrap gap-2">
            <a
              href={templateLink(',')}
              download="question-import-template.csv"
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <Download aria-hidden />
              Download the template
            </a>
            <a
              href={templateLink(';')}
              download="question-import-template-semicolons.csv"
              className={buttonClasses({ variant: 'ghost', size: 'sm' })}
            >
              Template with semicolons
            </a>
          </div>
          <details className="text-small text-fg">
            <summary className="cursor-pointer font-medium">What goes in each column</summary>
            <dl className="mt-2 flex flex-col gap-2">
              {QUESTION_CSV_COLUMNS.map((column) => (
                <div key={column.header}>
                  <dt className="font-medium">{column.header}</dt>
                  <dd className="text-muted">{column.help}</dd>
                </div>
              ))}
            </dl>
          </details>
        </div>
        <div className="flex flex-col">
          <Field
            label="Spreadsheet file"
            hint="A .csv file. Comma, semicolon and tab separators all work."
          >
            <Input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="py-1.5 file:mr-3 file:border-0 file:bg-transparent file:text-small file:font-medium file:text-fg"
              onChange={(event) => void choose(event.currentTarget.files?.[0])}
            />
          </Field>
          {/* Announces the preview when a file has been read. */}
          <div aria-live="polite">{chosen && <Preview chosen={chosen} room={room} />}</div>
        </div>
        {problem && (
          <p role="alert" className="text-small text-danger">
            {problem}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button disabled={adding === 0} loading={busy} onClick={() => void start()}>
            {adding === 0 ? 'Add questions' : `Add ${questionCount(adding)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
