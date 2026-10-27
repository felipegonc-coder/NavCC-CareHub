import { LIMITS, newId } from '@carehub/learning';
import { Button, Checkbox, Field, IconButton, Input, Textarea } from '@carehub/ui';
import { Plus, X } from 'lucide-react';
import type { JSX } from 'react';
import { ChoiceButtons, withOptionalText } from '../../fields';
import { RichTextInput } from './RichTextInput';
import type { EditorOf } from './TextBlocks';

const LIST_STYLES = [
  { value: 'bulleted', label: 'Bullets' },
  { value: 'numbered', label: 'Numbers' },
  { value: 'checkbox', label: 'Checkboxes' },
] as const;

/** List: bullets, numbers or checkboxes, and its items. */
export function ListEditor({ block, onChange, course }: EditorOf<'list'>): JSX.Element {
  const items = block.items;
  return (
    <div className="flex flex-col gap-3">
      <ChoiceButtons
        label="Style"
        value={block.style}
        options={LIST_STYLES}
        onChange={(style) => onChange({ ...block, style })}
      />
      {items.length > 0 && (
        <ol className="flex flex-col gap-2">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <RichTextInput
                  singleLine
                  ariaLabel={`Item ${index + 1}`}
                  value={item.text}
                  course={course}
                  onChange={(text) =>
                    onChange({
                      ...block,
                      items: items.map((i) => (i.id === item.id ? { ...i, text } : i)),
                    })
                  }
                />
              </div>
              <IconButton
                size="sm"
                label={`Remove item ${index + 1}`}
                onClick={() => onChange({ ...block, items: items.filter((i) => i.id !== item.id) })}
              >
                <X aria-hidden />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={items.length >= LIMITS.listItems}
        onClick={() => onChange({ ...block, items: [...items, { id: newId(), text: [] }] })}
      >
        <Plus aria-hidden />
        Add item
      </Button>
    </div>
  );
}

/** Quote carousel: up to 10 quotes, each with who said it. */
export function QuoteCarouselEditor({ block, onChange }: EditorOf<'quote_carousel'>): JSX.Element {
  const quotes = block.quotes;
  type Quote = (typeof quotes)[number];
  const update = (id: string, change: (quote: Quote) => Quote) =>
    onChange({ ...block, quotes: quotes.map((q) => (q.id === id ? change(q) : q)) });
  return (
    <div className="flex flex-col gap-3">
      {quotes.length > 0 && (
        <ol className="flex flex-col gap-3">
          {quotes.map((quote, index) => (
            <li key={quote.id} className="flex flex-col gap-2 rounded border border-border p-3">
              <Field label={`Quote ${index + 1}`}>
                <Textarea
                  rows={2}
                  value={quote.text}
                  maxLength={LIMITS.longText}
                  onChange={(e) => update(quote.id, (q) => ({ ...q, text: e.currentTarget.value }))}
                />
              </Field>
              <Field label={`Who said quote ${index + 1}`} hint="Optional.">
                <Input
                  value={quote.attribution ?? ''}
                  maxLength={LIMITS.title}
                  onChange={(e) =>
                    update(quote.id, (q) =>
                      withOptionalText(q, 'attribution', e.currentTarget.value),
                    )
                  }
                />
              </Field>
              <Button
                size="sm"
                variant="ghost"
                className="self-start"
                onClick={() =>
                  onChange({ ...block, quotes: quotes.filter((q) => q.id !== quote.id) })
                }
              >
                Remove quote {index + 1}
              </Button>
            </li>
          ))}
        </ol>
      )}
      <Button
        size="sm"
        variant="secondary"
        className="self-start"
        disabled={quotes.length >= LIMITS.quotes}
        onClick={() => onChange({ ...block, quotes: [...quotes, { id: newId(), text: '' }] })}
      >
        <Plus aria-hidden />
        Add quote
      </Button>
    </div>
  );
}

/** Table: plain text cells, with or without a header row; rows and columns added and removed at the end. */
export function TableEditor({ block, onChange }: EditorOf<'table'>): JSX.Element {
  const rows = block.rows.length;
  const columns = Math.max(1, ...block.rows.map((row) => row.length));
  const resize = (rowCount: number, columnCount: number) =>
    onChange({
      ...block,
      rows: Array.from({ length: rowCount }, (_, r) =>
        Array.from({ length: columnCount }, (_, c) => block.rows[r]?.[c] ?? ''),
      ),
    });
  const setCell = (r: number, c: number, text: string) =>
    onChange({
      ...block,
      rows: block.rows.map((row, ri) =>
        ri === r
          ? Array.from({ length: columns }, (_, ci) => (ci === c ? text : (row[ci] ?? '')))
          : row,
      ),
    });
  return (
    <div className="flex flex-col gap-3">
      <Field label="First row is a header" layout="inline">
        <Checkbox
          checked={block.headerRow}
          onCheckedChange={(checked) => onChange({ ...block, headerRow: checked === true })}
        />
      </Field>
      {rows > 0 && (
        <div className="overflow-x-auto">
          <table className="border-collapse">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {Array.from({ length: columns }, (_, c) => (
                    <td key={c} className="p-1">
                      <Input
                        aria-label={`Row ${r + 1}, column ${c + 1}`}
                        value={row[c] ?? ''}
                        maxLength={LIMITS.tableCell}
                        className="min-w-32"
                        onChange={(e) => setCell(r, c, e.currentTarget.value)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={rows >= LIMITS.tableRows}
          onClick={() => resize(rows + 1, columns)}
        >
          Add row
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={rows <= 1}
          onClick={() => resize(rows - 1, columns)}
        >
          Remove last row
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={columns >= LIMITS.tableColumns}
          onClick={() => resize(Math.max(rows, 1), columns + 1)}
        >
          Add column
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={columns <= 1}
          onClick={() => resize(rows, columns - 1)}
        >
          Remove last column
        </Button>
      </div>
    </div>
  );
}
