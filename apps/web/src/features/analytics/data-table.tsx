import { Button, VisuallyHidden, cn } from '@carehub/ui';
import { ArrowDown, ArrowUp, Download } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { downloadCsv, toCsv, type CsvCell } from './csv';

export interface Column<Row> {
  key: string;
  label: string;
  /** What the column sorts by and puts in the CSV. */
  value: (row: Row) => CsvCell;
  /** What the cell shows, when it isn't the value itself. */
  render?: (row: Row) => ReactNode;
  numeric?: boolean;
}

export type SortDirection = 'ascending' | 'descending';

interface DataTableProps<Row> {
  /** The table's name for screen readers, such as "Top pages". */
  caption: string;
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** The sort the rows come in, shown on that column. */
  sortedBy?: { key: string; direction: SortDirection };
  /** Export CSV saves `<fileName>.csv`. */
  fileName: string;
  testId: string;
}

const collator = new Intl.Collator('en-US', { numeric: true, sensitivity: 'base' });

function compare(a: CsvCell, b: CsvCell): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : collator.compare(`${a}`, `${b}`);
}

/**
 * A table that sorts by any column (its header is a button, so it works from the keyboard) and
 * exports what it shows as CSV, in the order shown. On phones it scrolls sideways.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  sortedBy,
  fileName,
  testId,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState(sortedBy);
  const shown = useMemo(() => {
    const column = columns.find((candidate) => candidate.key === sort?.key);
    if (!sort || !column) return rows;
    // A stable sort, so rows that tie keep the server's order.
    const sign = sort.direction === 'ascending' ? 1 : -1;
    return [...rows].sort((a, b) => sign * compare(column.value(a), column.value(b)));
  }, [columns, rows, sort]);

  const sortBy = (column: Column<Row>) =>
    setSort((current) => ({
      key: column.key,
      direction:
        current?.key === column.key
          ? current.direction === 'ascending'
            ? 'descending'
            : 'ascending'
          : column.numeric
            ? 'descending'
            : 'ascending',
    }));

  const exportCsv = () =>
    downloadCsv(
      `${fileName}.csv`,
      toCsv(
        columns.map((column) => column.label),
        shown.map((row) => columns.map((column) => column.value(row))),
      ),
    );

  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-small">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border">
              {columns.map((column) => {
                const direction = sort?.key === column.key ? sort.direction : undefined;
                const Arrow = direction === 'ascending' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={direction}
                    className={cn(
                      'whitespace-nowrap py-2 pr-4 font-medium text-muted last:pr-0',
                      column.numeric ? 'text-right' : 'text-left',
                    )}
                  >
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm hover:text-fg"
                      onClick={() => sortBy(column)}
                    >
                      {column.label}
                      {direction && <Arrow aria-hidden className="size-3.5" />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'py-2 pr-4 last:pr-0',
                      column.numeric && 'text-right tabular-nums',
                    )}
                  >
                    {column.render ? column.render(row) : column.value(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button variant="ghost" size="sm" onClick={exportCsv}>
          <Download aria-hidden className="size-4" />
          Export CSV
          <VisuallyHidden> of {caption.toLowerCase()}</VisuallyHidden>
        </Button>
      </div>
    </div>
  );
}
