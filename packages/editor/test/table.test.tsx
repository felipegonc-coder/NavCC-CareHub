import type { JSONContent } from '@tiptap/core';
import {
  DOMParser as SchemaParser,
  DOMSerializer,
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
} from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { BlockEditor, type Editor } from '../src';
import {
  clearCells,
  colorCells,
  limitPastedTables,
  moveRowsBy,
  TABLE_MAX_ROWS,
  tableHeaders,
  toggleTableHeader,
} from '../src/blocks/table';
import { blockSlashItems } from '../src/blocks/ui';
import { createPageSchema } from '../src/schema';
import { createTestEditor, flush, pressKey } from './helpers';

let editor: Editor | undefined;
let root: Root | undefined;

afterEach(async () => {
  editor?.destroy();
  editor = undefined;
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

const cell = (text: string): JSONContent => ({
  type: 'tableCell',
  content: [
    text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' },
  ],
});

/** A table with one row per entry and one cell per text. */
const table = (rows: string[][], attrs: Record<string, unknown> = {}): JSONContent => ({
  type: 'table',
  attrs,
  content: rows.map((texts) => ({ type: 'tableRow', content: texts.map(cell) })),
});

const page = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** The first table on the page, and where it is. */
function findTable(doc: ProseMirrorNode): { node: ProseMirrorNode; pos: number } {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (!found && node.type.name === 'table') found = { node, pos };
    return !found;
  });
  if (!found) throw new Error('No table on the page');
  return found;
}

/** The text of each cell, row by row. */
const texts = (current: Editor) => {
  const rows: string[][] = [];
  findTable(current.state.doc).node.forEach((row) => {
    const cells: string[] = [];
    row.forEach((entry) => cells.push(entry.textContent));
    rows.push(cells);
  });
  return rows;
};

/** H for a header cell, C for a cell, row by row. */
const kinds = (current: Editor) => {
  const rows: string[] = [];
  findTable(current.state.doc).node.forEach((row) => {
    let line = '';
    row.forEach((entry) => (line += entry.type.name === 'tableHeader' ? 'H' : 'C'));
    rows.push(line);
  });
  return rows;
};

/** The position just inside the cell whose text is `text`. */
function inCell(current: Editor, text: string): number {
  let found = -1;
  current.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos;
    return found === -1;
  });
  if (found === -1) throw new Error(`No cell says ${text}`);
  return found;
}

async function tableEditor(rows: string[][]) {
  const current = await createTestEditor();
  current.commands.setContent(page(table(rows)));
  return current;
}

/** The page editor with its React views, showing `content`. */
async function renderEditor(content: JSONContent) {
  const container = document.createElement('div');
  document.body.append(container);
  const ready: { editor?: Editor } = {};
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <BlockEditor ydoc={new Y.Doc()} onReady={(current) => (ready.editor = current)} />,
    ),
  );
  await act(flush);
  const current = ready.editor;
  if (!current) throw new Error('The editor did not start');
  await act(async () => {
    current.commands.setContent(content);
    await flush();
  });
  return { container, editor: current };
}

async function press(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) throw new Error('Nothing to press');
  await act(async () => {
    element.click();
    await flush();
  });
}

const buttonNamed = (container: Element, name: string) =>
  [...container.querySelectorAll('button')].find((button) => button.textContent === name);

describe('table schema', () => {
  it('holds text in cells, with cell colors and Fit to page width', () => {
    const schema = createPageSchema();
    expect(schema.nodes.tableCell?.spec.content).toBe('paragraph+');
    expect(schema.nodes.tableHeader?.spec.content).toBe('paragraph+');
    const element = document.createElement('div');
    element.innerHTML =
      '<table data-fit-width=""><tbody><tr>' +
      '<th data-background="blue"><p>Ward</p></th><td data-background="teal">4</td>' +
      '</tr></tbody></table>';
    const parsed = SchemaParser.fromSchema(schema).parse(element).firstChild;
    expect(parsed?.type.name).toBe('table');
    expect(parsed?.attrs.fitWidth).toBe(true);
    const row = parsed?.firstChild;
    expect(row?.child(0).type.name).toBe('tableHeader');
    expect(row?.child(0).attrs.background).toBe('blue');
    expect(row?.child(1).attrs.background).toBeNull();
    expect(row?.child(1).firstChild?.type.name).toBe('paragraph');
    if (!parsed) return;
    const html = document.createElement('div');
    html.append(DOMSerializer.fromSchema(schema).serializeNode(parsed));
    expect(html.querySelector('table')?.hasAttribute('data-fit-width')).toBe(true);
    expect(html.querySelector('th')?.getAttribute('data-background')).toBe('blue');
    expect(html.querySelector('td')?.hasAttribute('data-background')).toBe(false);
  });

  it('cuts pasted tables to the most rows and columns', () => {
    const schema = createPageSchema();
    const big = schema.nodeFromJSON(
      table([
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
        ['g', 'h', 'i'],
      ]),
    );
    const slice = new Slice(Fragment.from(big), 0, 0);
    expect(limitPastedTables(slice, 5, 5)).toBe(slice);
    const cut = limitPastedTables(slice, 2, 2).content.firstChild;
    expect(cut?.childCount).toBe(2);
    expect(cut?.firstChild?.childCount).toBe(2);
    expect(cut?.textContent).toBe('abde');
    const rows = limitPastedTables(new Slice(big.content, 0, 0), 1, 3).content;
    expect(rows.childCount).toBe(1);
    expect(rows.firstChild?.textContent).toBe('abc');
  });
});

describe('table commands', () => {
  it('makes a 3 by 3 table without headers from "/"', async () => {
    editor = await createTestEditor();
    editor.view.focus();
    blockSlashItems.find((item) => item.id === 'table')?.run(editor, { pageId: null });
    expect(texts(editor)).toEqual([
      ['', '', ''],
      ['', '', ''],
      ['', '', ''],
    ]);
    expect(kinds(editor)).toEqual(['CCC', 'CCC', 'CCC']);
  });

  it('moves rows with Ctrl+Shift+Up and Down, keeping the cursor in the moved row', async () => {
    editor = await tableEditor([['A'], ['B'], ['C']]);
    editor.commands.setTextSelection(inCell(editor, 'B'));
    expect(moveRowsBy(editor, -1)).toBe(true);
    expect(texts(editor)).toEqual([['B'], ['A'], ['C']]);
    expect(editor.state.selection.$from.parent.textContent).toBe('B');
    expect(pressKey(editor, 'ArrowDown', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(pressKey(editor, 'ArrowDown', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(texts(editor)).toEqual([['A'], ['C'], ['B']]);
    expect(editor.state.selection.$from.parent.textContent).toBe('B');
    expect(moveRowsBy(editor, 1)).toBe(true);
    expect(texts(editor)).toEqual([['A'], ['C'], ['B']]);
  });

  it('turns the header row and column on and off, keeping the corner while the other is on', async () => {
    editor = await tableEditor([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const toggle = (kind: 'row' | 'column') => {
      const current = editor;
      if (!current) return;
      const tr = current.state.tr;
      toggleTableHeader(tr, findTable(current.state.doc).pos, kind);
      current.view.dispatch(tr);
    };
    const headers = () => (editor ? tableHeaders(findTable(editor.state.doc).node) : null);
    toggle('row');
    expect(kinds(editor)).toEqual(['HH', 'CC']);
    expect(headers()).toEqual({ row: true, column: false });
    toggle('column');
    expect(kinds(editor)).toEqual(['HH', 'HC']);
    toggle('row');
    expect(kinds(editor)).toEqual(['HC', 'HC']);
    expect(headers()).toEqual({ row: false, column: true });
    toggle('column');
    expect(kinds(editor)).toEqual(['CC', 'CC']);
  });

  it('colors and clears cells, keeping their colors', async () => {
    editor = await tableEditor([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    const firstRow = { left: 0, top: 0, right: 2, bottom: 1 };
    const { pos } = findTable(editor.state.doc);
    editor.view.dispatch(colorCells(editor.state.tr, pos, firstRow, 'blue'));
    editor.view.dispatch(clearCells(editor.state.tr, pos, firstRow));
    expect(texts(editor)).toEqual([
      ['', ''],
      ['c', 'd'],
    ]);
    const colors: unknown[] = [];
    findTable(editor.state.doc).node.forEach((row) =>
      row.forEach((entry) => colors.push(entry.attrs.background)),
    );
    expect(colors).toEqual(['blue', 'blue', null, null]);
  });

  it('adds a row with Tab in the last cell, until the table has 1,000 rows', async () => {
    editor = await tableEditor([['a'], ['b']]);
    editor.commands.setTextSelection(inCell(editor, 'b'));
    expect(pressKey(editor, 'Tab')).toBe(true);
    expect(texts(editor)).toEqual([['a'], ['b'], ['']]);

    const rows = Array.from({ length: TABLE_MAX_ROWS }, (_, index) => [`Row ${index + 1}`]);
    editor.commands.setContent(page(table(rows)));
    editor.commands.setTextSelection(inCell(editor, `Row ${TABLE_MAX_ROWS}`));
    expect(pressKey(editor, 'Tab')).toBe(true);
    expect(findTable(editor.state.doc).node.childCount).toBe(TABLE_MAX_ROWS);
  });
});

describe('table view', () => {
  it('sizes its columns, and adds rows and columns from the + bars', async () => {
    const { container, editor: current } = await renderEditor(
      page(
        table([
          ['a', 'b', 'c'],
          ['d', 'e', 'f'],
        ]),
      ),
    );
    const element = container.querySelector('table');
    expect(element?.firstChild?.nodeName).toBe('COLGROUP');
    expect(element?.querySelectorAll('col')).toHaveLength(3);
    expect(element?.style.width).toBe('360px');

    await press(container.querySelector('button[aria-label="Add a row"]'));
    expect(texts(current)).toHaveLength(3);
    await press(container.querySelector('button[aria-label="Add a column"]'));
    expect(texts(current)[0]).toHaveLength(4);
    expect(element?.querySelectorAll('col')).toHaveLength(4);
  });

  it('has Header row and Fit to page width in its "…" menu', async () => {
    const { container, editor: current } = await renderEditor(page(table([['a', 'b']])));
    await press(container.querySelector('button[aria-label="Table options"]'));
    await press(buttonNamed(container, 'Header row'));
    expect(kinds(current)).toEqual(['HH']);
    expect(buttonNamed(container, 'Header row')?.getAttribute('aria-pressed')).toBe('true');
    await press(buttonNamed(container, 'Fit to page width'));
    expect(findTable(current.state.doc).node.attrs.fitWidth).toBe(true);
    expect(container.querySelector('table')?.style.width).toBe('100%');
  });

  it('moves a row from its handle menu', async () => {
    const { container, editor: current } = await renderEditor(page(table([['a'], ['b']])));
    await act(async () => {
      current.commands.setTextSelection(inCell(current, 'a'));
      await flush();
    });
    await press(container.querySelector('button[aria-label="Row options"]'));
    await press(buttonNamed(container, 'Move down'));
    expect(texts(current)).toEqual([['b'], ['a']]);
  });

  it('colors the selected cells from the bar above them', async () => {
    const { container, editor: current } = await renderEditor(page(table([['a', 'b']])));
    await act(async () => {
      const { doc } = current.state;
      const $a = doc.resolve(inCell(current, 'a'));
      const $b = doc.resolve(inCell(current, 'b'));
      const anchor = doc.resolve($a.before($a.depth - 1));
      const head = doc.resolve($b.before($b.depth - 1));
      current.view.dispatch(current.state.tr.setSelection(new CellSelection(anchor, head)));
      await flush();
    });
    const select = container.querySelector('.ch-table-cell-bar select');
    if (!(select instanceof HTMLSelectElement)) throw new Error('No color menu');
    await act(async () => {
      select.value = 'green';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await flush();
    });
    const colors: unknown[] = [];
    findTable(current.state.doc).node.forEach((row) =>
      row.forEach((entry) => colors.push(entry.attrs.background)),
    );
    expect(colors).toEqual(['green', 'green']);
  });
});
