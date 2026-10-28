/**
 * Import CSV (spec 3.7), opened from "…" → Import CSV and from "No rows yet.": pick a CSV or Excel
 * file, check the preview and match each column, then the import runs on the server with a
 * progress bar, and the summary offers the list of problems and Undo import. Imports only add rows.
 */
import type { DatabaseMeta, Viewer } from '@carehub/databases';
import { CSV_SEPARATORS, validatePlan } from '@carehub/databases/csv';
import type { XlsxSheet } from '@carehub/databases/xlsx';
import { Button, Checkbox, Field, Label, Spinner } from '@carehub/ui';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { UNKNOWN_ERROR_MESSAGE } from '../api';
import { NativeSelect } from '../cells/controls';
import type { PanelProps } from '../contract';
import { useDatabaseClient } from '../hooks';
import { ColumnMatches, PreviewTable, ProblemList } from './column-plan';
import {
  checkPickedFile,
  chooseTarget,
  errorMessage,
  errorSheets,
  fileKind,
  fillsSomething,
  importBody,
  readFileData,
  readPreview,
  readStarted,
  withTarget,
  type ImportChoices,
  type ImportPreview,
  type PickedFile,
  type PreviewColumn,
} from './import-model';
import { IMPORT_TEXT } from './import-text';
import { ImportResult } from './import-result';
import { forgetImport, rememberImport, startedImport, type StartedImport } from './started';

const ACCEPT = '.csv,.tsv,.xlsx,text/csv,text/tab-separated-values';

export default function ImportDialog({ meta, viewer, close }: PanelProps) {
  // An import started earlier keeps running while the dialog is closed; it shows again here.
  const [started, setStarted] = useState<StartedImport | null>(() => startedImport(meta.id));
  const begin = (value: StartedImport) => {
    rememberImport(meta.id, value);
    setStarted(value);
  };
  const back = () => {
    forgetImport(meta.id);
    setStarted(null);
  };
  return (
    <>
      {started && <ImportResult meta={meta} started={started} onBack={back} close={close} />}
      {/* Kept while the import runs, so Back after a failed import has the file and its columns. */}
      <div hidden={started !== null}>
        <ImportSetup meta={meta} viewer={viewer} onStarted={begin} close={close} />
      </div>
    </>
  );
}

type Busy = 'reading' | 'previewing' | 'starting' | null;

interface ImportSetupProps {
  meta: DatabaseMeta;
  viewer: Viewer;
  onStarted(value: StartedImport): void;
  close(): void;
}

/** Upload, then the preview with the options and the columns, then Import. */
function ImportSetup({ meta, viewer, onStarted, close }: ImportSetupProps) {
  const client = useDatabaseClient();
  const id = useId();
  const [file, setFile] = useState<PickedFile | null>(null);
  const [choices, setChoices] = useState<ImportChoices>({ firstRowIsHeaders: true });
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [plan, setPlan] = useState<PreviewColumn[]>([]);
  const [sheets, setSheets] = useState<XlsxSheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  // Only the newest preview counts when several are asked for.
  const latest = useRef(0);

  /** Asks for a preview: a fresh plan without `columns`, or the person's plan with them. */
  const askPreview = async (picked: PickedFile, next: ImportChoices, columns?: PreviewColumn[]) => {
    const request = ++latest.current;
    setBusy('previewing');
    setError(null);
    try {
      const answer = await client.previewImport(meta.id, importBody(picked, next, columns));
      if (request !== latest.current) return;
      const read = readPreview(answer, { kind: picked.kind, choices: next });
      if (!read) {
        setPreview(null);
        setError(UNKNOWN_ERROR_MESSAGE);
        return;
      }
      setPreview(read);
      if (read.sheets) setSheets(read.sheets);
      if (!columns) {
        setPlan(read.columns);
        setChoices({
          firstRowIsHeaders: read.firstRowIsHeaders,
          separator: read.separator ?? next.separator,
          sheet: read.sheet ?? next.sheet,
        });
      }
    } catch (e) {
      if (request !== latest.current) return;
      setError(errorMessage(e));
      const listed = errorSheets(e);
      if (listed) setSheets(listed);
      // A fresh plan that failed leaves nothing to match; a changed plan keeps the last preview.
      if (!columns) {
        setPreview(null);
        setPlan([]);
      }
    } finally {
      if (request === latest.current) setBusy(null);
    }
  };

  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    event.target.value = '';
    if (!picked) return;
    const request = ++latest.current;
    setBusy(null);
    setFile(null);
    setPreview(null);
    setPlan([]);
    setSheets(null);
    const refused = checkPickedFile(picked);
    setError(refused);
    if (refused) return;
    setBusy('reading');
    let data: string;
    try {
      data = await readFileData(picked);
    } catch {
      if (request !== latest.current) return;
      setBusy(null);
      setError(IMPORT_TEXT.unreadable);
      return;
    }
    if (request !== latest.current) return;
    const next: PickedFile = { name: picked.name, kind: fileKind(picked.name) ?? 'csv', data };
    const fresh: ImportChoices = { firstRowIsHeaders: true };
    setFile(next);
    setChoices(fresh);
    await askPreview(next, fresh);
  };

  const changeChoices = (next: ImportChoices) => {
    if (!file) return;
    setChoices(next);
    void askPreview(file, next);
  };

  /** Matches and types change what the preview shows, so it's asked for again when the plan is valid. */
  const changePlan = (next: PreviewColumn[], refresh: boolean) => {
    setPlan(next);
    if (refresh && file && fillsSomething(next) && !validatePlan(next, meta.properties)) {
      void askPreview(file, choices, next);
    }
  };

  const start = async () => {
    if (!file) return;
    latest.current++;
    setBusy('starting');
    setError(null);
    try {
      const answer = readStarted(
        await client.startImport(meta.id, importBody(file, choices, plan)),
      );
      setBusy(null);
      if (!answer) setError(UNKNOWN_ERROR_MESSAGE);
      else onStarted({ ...answer, fileName: file.name });
    } catch (e) {
      setBusy(null);
      setError(errorMessage(e));
    }
  };

  const planProblem = preview
    ? fillsSomething(plan)
      ? validatePlan(plan, meta.properties)
      : IMPORT_TEXT.nothingToImport
    : null;
  const working = busy !== null;

  return (
    <div className="grid gap-4">
      <p className="text-small text-muted">{IMPORT_TEXT.intro}</p>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-file`}>{IMPORT_TEXT.file}</Label>
        <input
          id={`${id}-file`}
          type="file"
          accept={ACCEPT}
          aria-describedby={`${id}-file-hint`}
          disabled={busy === 'reading' || busy === 'starting'}
          onChange={(event) => void pick(event)}
          className="text-small text-fg file:mr-3 file:rounded file:border file:border-border file:bg-bg file:px-3 file:py-1.5 file:text-small file:font-medium file:text-fg hover:file:bg-fill-hover"
        />
        <p id={`${id}-file-hint`} className="text-label text-muted">
          {file ? file.name : IMPORT_TEXT.fileHint}
        </p>
      </div>

      {file && (
        <div className="flex flex-wrap items-end gap-4">
          <Field label={IMPORT_TEXT.firstRowIsHeaders} layout="inline">
            <Checkbox
              checked={choices.firstRowIsHeaders}
              disabled={working}
              onCheckedChange={(checked) =>
                changeChoices({ ...choices, firstRowIsHeaders: checked === true })
              }
            />
          </Field>
          {file.kind === 'csv' && (
            <Field label={IMPORT_TEXT.separator}>
              <NativeSelect
                value={choices.separator ?? ','}
                disabled={working}
                onChange={(event) => {
                  const separator = CSV_SEPARATORS.find((s) => s === event.target.value);
                  if (separator) changeChoices({ ...choices, separator });
                }}
              >
                {CSV_SEPARATORS.map((s) => (
                  <option key={s} value={s}>
                    {IMPORT_TEXT.separators[s]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
          {file.kind === 'xlsx' && sheets && sheets.length > 0 && (
            <Field label={IMPORT_TEXT.sheet}>
              <NativeSelect
                value={choices.sheet ?? sheets[0]?.name ?? ''}
                disabled={working}
                onChange={(event) => changeChoices({ ...choices, sheet: event.target.value })}
              >
                {sheets.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.hidden ? IMPORT_TEXT.hiddenSheet(s.name) : s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </div>
      )}

      {(busy === 'reading' || busy === 'previewing') && (
        <Spinner label={busy === 'reading' ? IMPORT_TEXT.reading : IMPORT_TEXT.updating} />
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}

      {preview && (
        <>
          <ColumnMatches
            plan={plan}
            properties={meta.properties}
            problem={planProblem}
            disabled={busy === 'starting'}
            onChoose={(index, value) =>
              changePlan(chooseTarget(plan, index, value, meta.properties), true)
            }
            onRename={(index, name) => {
              const column = plan.find((c) => c.index === index);
              if (column?.target.kind === 'new') {
                changePlan(withTarget(plan, index, { ...column.target, name }), false);
              }
            }}
            onRetype={(index, type) => {
              const column = plan.find((c) => c.index === index);
              if (column?.target.kind === 'new') {
                changePlan(withTarget(plan, index, { ...column.target, type }), true);
              }
            }}
          />
          <PreviewTable preview={preview} properties={meta.properties} viewer={viewer} />
          <ProblemList problems={preview.problems} count={preview.problemCount} />
        </>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={close}>
          {IMPORT_TEXT.cancel}
        </Button>
        <Button
          disabled={!preview || working || planProblem !== null}
          aria-busy={busy === 'starting'}
          onClick={() => void start()}
        >
          {IMPORT_TEXT.import}
        </Button>
      </div>
    </div>
  );
}
