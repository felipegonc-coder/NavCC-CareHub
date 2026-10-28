import { TYPE_LABELS, type Property, type Viewer } from '@carehub/databases';
import { canImportInto, NEW_PROPERTY_TYPES, type ImportProblem } from '@carehub/databases/csv';
import { Input, Label } from '@carehub/ui';
import { useId, useMemo } from 'react';
import { CellView, type CellContext } from '../cells';
import { NativeSelect } from '../cells/controls';
import {
  previewValue,
  shownColumns,
  targetValue,
  type ImportPreview,
  type PreviewColumn,
} from './import-model';
import { IMPORT_TEXT } from './import-text';

export interface ColumnMatchesProps {
  plan: readonly PreviewColumn[];
  properties: readonly Property[];
  /** What's wrong with the plan (validatePlan's words), shown under it. */
  problem: string | null;
  disabled: boolean;
  /** A column's select changed (`value` as targetValue makes it). */
  onChoose(index: number, value: string): void;
  onRename(index: number, name: string): void;
  onRetype(index: number, type: PreviewColumn['guessedType']): void;
}

/** Each column of the file and what it fills: a property, a new property, or Skip. */
export function ColumnMatches({ plan, properties, problem, ...actions }: ColumnMatchesProps) {
  const id = useId();
  const fillable = useMemo(() => properties.filter(canImportInto), [properties]);
  return (
    <fieldset className="grid gap-3" aria-describedby={problem ? `${id}-problem` : undefined}>
      <legend className="mb-2 text-small font-semibold text-fg">{IMPORT_TEXT.columns}</legend>
      {plan.map((column) => (
        <ColumnMatch key={column.index} column={column} fillable={fillable} {...actions} />
      ))}
      {problem && (
        <p id={`${id}-problem`} role="alert" className="text-label text-danger">
          {problem}
        </p>
      )}
    </fieldset>
  );
}

type ColumnMatchProps = Omit<ColumnMatchesProps, 'plan' | 'properties' | 'problem'> & {
  column: PreviewColumn;
  fillable: readonly Property[];
};

function ColumnMatch({
  column,
  fillable,
  disabled,
  onChoose,
  onRename,
  onRetype,
}: ColumnMatchProps) {
  const id = useId();
  const t = column.target;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="grid gap-1">
        <Label htmlFor={id}>{column.header}</Label>
        <NativeSelect
          id={id}
          value={targetValue(t)}
          disabled={disabled}
          onChange={(event) => onChoose(column.index, event.target.value)}
        >
          {fillable.map((p) => (
            <option key={p.id} value={targetValue({ kind: 'existing', propertyId: p.id })}>
              {p.name}
            </option>
          ))}
          <option value="new">{IMPORT_TEXT.newProperty}</option>
          <option value="skip">{IMPORT_TEXT.skip}</option>
        </NativeSelect>
      </div>
      {t.kind === 'new' && (
        <div className="grid grid-cols-2 gap-2 self-end">
          <Input
            aria-label={IMPORT_TEXT.newName(column.header)}
            value={t.name}
            disabled={disabled}
            onChange={(event) => onRename(column.index, event.target.value)}
          />
          <NativeSelect
            aria-label={IMPORT_TEXT.newType(column.header)}
            value={t.type}
            disabled={disabled}
            onChange={(event) => {
              const type = NEW_PROPERTY_TYPES.find((x) => x === event.target.value);
              if (type) onRetype(column.index, type);
            }}
          >
            {NEW_PROPERTY_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
    </div>
  );
}

export interface PreviewTableProps {
  preview: ImportPreview;
  properties: readonly Property[];
  viewer: Viewer;
}

/** The first rows (20) as the import would save them, one column per property it fills. */
export function PreviewTable({ preview, properties, viewer }: PreviewTableProps) {
  const id = useId();
  const columns = useMemo(() => shownColumns(preview, properties), [preview, properties]);
  const ctx = useMemo<CellContext>(
    () => ({
      viewer,
      userName: () => undefined,
      properties: [...properties, ...preview.newProperties],
    }),
    [viewer, properties, preview.newProperties],
  );
  return (
    <section className="grid gap-2" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-small font-semibold text-fg">
        {IMPORT_TEXT.preview}
      </h3>
      <p className="text-small text-muted">
        {IMPORT_TEXT.rowCount(preview.rowCount)}
        {preview.rowCount > preview.rows.length &&
          preview.rows.length > 0 &&
          ` ${IMPORT_TEXT.firstRows(preview.rows.length)}`}
      </p>
      {columns.length > 0 && preview.rows.length > 0 && (
        <div className="max-h-64 overflow-auto rounded border border-border">
          <table aria-labelledby={`${id}-title`} className="w-full text-small">
            <thead className="bg-fill">
              <tr>
                <th scope="col" className="px-2 py-1 text-left font-medium text-muted">
                  {IMPORT_TEXT.row}
                </th>
                {columns.map((c) => (
                  <th
                    key={c.index}
                    scope="col"
                    className="whitespace-nowrap px-2 py-1 text-left font-medium text-muted"
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={row.rowNumber} className="border-t border-border">
                  <td className="px-2 py-1 text-muted">{row.rowNumber}</td>
                  {columns.map((c) => (
                    <td key={c.index} className="max-w-48 px-2 py-1">
                      <CellView
                        property={c.property}
                        value={previewValue(row, c.property)}
                        ctx={ctx}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The values that couldn't be read, with their row numbers (the first ones the server lists). */
export function ProblemList({
  problems,
  count,
}: {
  problems: readonly ImportProblem[];
  count: number;
}) {
  const id = useId();
  if (count === 0) return null;
  return (
    <section className="grid gap-2" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-small font-semibold text-fg">
        {IMPORT_TEXT.problems}
      </h3>
      <p className="text-small text-fg">{IMPORT_TEXT.couldntRead(count)}</p>
      {problems.length > 0 && (
        <div className="max-h-48 overflow-auto rounded border border-border">
          <table aria-labelledby={`${id}-title`} className="w-full text-small">
            <thead className="bg-fill">
              <tr>
                {IMPORT_TEXT.problemColumns.map((name) => (
                  <th key={name} scope="col" className="px-2 py-1 text-left font-medium text-muted">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {problems.map((p, i) => (
                <tr key={`${p.row}-${p.column}-${i}`} className="border-t border-border">
                  <td className="px-2 py-1 text-muted">{p.row}</td>
                  <td className="px-2 py-1">{p.column}</td>
                  <td className="max-w-48 truncate px-2 py-1">{p.value}</td>
                  <td className="px-2 py-1">{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
