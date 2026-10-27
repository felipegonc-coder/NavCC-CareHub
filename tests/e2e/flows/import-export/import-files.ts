import { randomUUID } from 'node:crypto';
import { posix } from 'node:path';
import { png, zip, type FilePayload } from './zip-files.js';

// The fictional files the import checks pick. Each says what it should become, so a test can
// compare the page tree it finds with the tree it imported.

/** A relative link from one file in the zip to another, as exports write them. */
const linkTo = (from: string, to: string) =>
  posix.relative(posix.dirname(from), to).split('/').map(encodeURIComponent).join('/');

/**
 * IE-01: a Markdown zip with a folder and two pictures. Intake guide links to Escalation steps,
 * which links back; each has a picture next to it.
 */
export function markdownZip(): FilePayload & { tree: string[] } {
  const intake = 'Intake guide.md';
  const steps = 'Escalations/Escalation steps.md';
  return {
    name: 'Fictional QA handbook.zip',
    mimeType: 'application/zip',
    tree: ['Escalations', 'Escalations/Escalation steps', 'Intake guide'],
    buffer: zip([
      {
        path: intake,
        data: `# Intake guide\n\nRead [Escalation steps](${linkTo(intake, steps)}) before a hard call.\n\n![Front desk](front-desk.png)\n`,
      },
      { path: 'front-desk.png', data: png(48, 32, [46, 125, 50]) },
      {
        path: steps,
        data: `# Escalation steps\n\nStart from the [Intake guide](${linkTo(steps, intake)}).\n\n![Phone tree](phone-tree.png)\n`,
      },
      { path: 'Escalations/phone-tree.png', data: png(48, 32, [21, 101, 192]) },
    ]),
  };
}

type NotionPage = { title: string; id: string; file: string; folder: string };

type Column = { name: string; type: 'title' | 'text' | 'number' | 'select' | 'formula' };

/** A page of the export: "<title> <32 hex>.html", with its sub-pages in "<title> <32 hex>/". */
function notionPage(title: string, inFolder = ''): NotionPage {
  const id = randomUUID().replaceAll('-', '');
  return {
    title,
    id,
    file: `${inFolder}${title} ${id}.html`,
    folder: `${inFolder}${title} ${id}/`,
  };
}

const a = (from: NotionPage, to: NotionPage) =>
  `<a href="${linkTo(from.file, to.file)}">${to.title}</a>`;

const icon = (type: Column['type']) =>
  `<span class="icon property-icon"><svg role="graphics-symbol" viewBox="0 0 16 16" class="types${type.replace(/^./, (c) => c.toUpperCase())}"></svg></span>`;

const html = (page: NotionPage, header: string, body: string) =>
  `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><title>${page.title}</title></head><body><article id="${page.id.replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-')}" class="page sans"><header><h1 class="page-title">${page.title}</h1>${header}</header><div class="page-body">${body}</div></article></body></html>`;

/** A database: its page with the table, and a page per row with its properties and its text. */
function database(
  parent: NotionPage,
  title: string,
  columns: Column[],
  rows: { cells: string[]; text: string }[],
) {
  const page = notionPage(title, parent.folder);
  const made = rows.map((row) => ({ ...row, page: notionPage(row.cells[0] ?? '', page.folder) }));
  const value = (column: Column, text = '') =>
    column.type === 'select'
      ? `<span class="selected-value select-value-color-blue">${text}</span>`
      : text;
  const head = columns.map((column) => `<th>${icon(column.type)}${column.name}</th>`).join('');
  const body = made.map(
    (row) =>
      `<tr id="${row.page.id}"><td class="cell-title">${a(page, row.page)}</td>${columns
        .slice(1)
        .map((column, c) => `<td>${value(column, row.cells[c + 1])}</td>`)
        .join('')}</tr>`,
  );
  const table = `<table class="collection-content"><thead><tr>${head}</tr></thead><tbody>${body.join('')}</tbody></table>`;
  const rowFile = (row: (typeof made)[number]) => {
    const properties = columns
      .slice(1)
      .map(
        (column, c) =>
          `<tr class="property-row property-row-${column.type}"><th>${icon(column.type)}${column.name}</th><td>${value(column, row.cells[c + 1])}</td></tr>`,
      );
    const header = `<table class="properties"><tbody>${properties.join('')}</tbody></table>`;
    return { path: row.page.file, data: html(row.page, header, `<p>${row.text}</p>`) };
  };
  return {
    page,
    rows: made.map((row) => row.page),
    files: [{ path: page.file, data: html(page, '', table) }, ...made.map(rowFile)],
  };
}

/**
 * IE-04: a Notion export of one page with 3 databases and a sub-page, in the HTML flavour, whose
 * tables say each property's type. Total and Overtime are formulas.
 */
export function notionExport() {
  const support = notionPage('Fictional QA Support');
  const notes = notionPage('Escalation notes', support.folder);
  const callbacks = database(
    support,
    'Callbacks',
    [
      { name: 'Name', type: 'title' },
      { name: 'Status', type: 'select' },
      { name: 'Calls', type: 'number' },
      { name: 'Total', type: 'formula' },
    ],
    [
      { cells: ['Call Rowan', 'Open', '2', '4'], text: 'Rowan asked for a callback after 4 PM.' },
      { cells: ['Call Sky', 'Done', '1', '2'], text: 'Sky was helped on the first call.' },
    ],
  );
  const contacts = database(
    support,
    'Contacts',
    [
      { name: 'Name', type: 'title' },
      { name: 'Phone', type: 'text' },
    ],
    [{ cells: ['Rowan Lee', '555-0100'], text: 'A fictional caller.' }],
  );
  const shifts = database(
    support,
    'Shifts',
    [
      { name: 'Name', type: 'title' },
      { name: 'Hours', type: 'number' },
      { name: 'Overtime', type: 'formula' },
    ],
    [{ cells: ['Morning shift', '8', 'No'], text: 'Covers the front desk from 7 AM.' }],
  );
  const rowan = callbacks.rows[0] as NotionPage;
  const children = [callbacks.page, contacts.page, shifts.page, notes]
    .map((child) => `<figure class="link-to-page">${a(support, child)}</figure>`)
    .join('');
  const file: FilePayload = {
    name: `Export-${randomUUID()}.zip`,
    mimeType: 'application/zip',
    buffer: zip([
      {
        path: support.file,
        data: html(support, '', `<p>Fictional team notes for the import check.</p>${children}`),
      },
      {
        path: notes.file,
        data: html(notes, '', `<p>Back to ${a(notes, support)}. Waiting: ${a(notes, rowan)}.</p>`),
      },
      ...callbacks.files,
      ...contacts.files,
      ...shifts.files,
    ]),
  };
  return {
    file,
    tree: [
      'Fictional QA Support',
      'Fictional QA Support/Callbacks',
      'Fictional QA Support/Contacts',
      'Fictional QA Support/Escalation notes',
      'Fictional QA Support/Shifts',
    ],
    rows: 4,
    rowText: 'Rowan asked for a callback after 4 PM.',
    formulas: ['Total', 'Overtime'],
  };
}
