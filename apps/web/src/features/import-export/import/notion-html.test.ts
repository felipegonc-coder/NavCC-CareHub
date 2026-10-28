import type { PlanNode } from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { htmlToContent } from './html';
import { cellValue, readNotionPage, tableOf } from './notion-html';

const icon = (type: string) =>
  `<span class="icon property-icon"><svg viewBox="0 0 16 16" class="types${type}"><path d="M1 1"></path></svg></span>`;
const select = (value: string) =>
  `<span class="selected-value select-value-color-blue">${value}</span>`;

/** A page as Notion's HTML export writes it. */
const notionPage = (title: string, body: string, properties = '') =>
  `<html><head><title>${title}</title><style>p{color:red}</style></head><body>` +
  `<article class="page sans"><header><h1 class="page-title">${title}</h1>` +
  `<table class="properties"><tbody>${properties}</tbody></table></header>` +
  `<div class="page-body">${body}</div></article></body></html>`;

const cell = (html: string) => {
  const row = new DOMParser().parseFromString(
    `<table><tr><td>${html}</td></tr></table>`,
    'text/html',
  );
  return cellValue(row.querySelector('td') as Element);
};

/** Each block's type, with its text, its own blocks below it. */
function outline(nodes: PlanNode[] = [], depth = 0): string[] {
  const textOf = (node: PlanNode): string =>
    node.text ??
    (node.content ?? [])
      .filter((child) => !isBlock(child))
      .map(textOf)
      .join('');
  const isBlock = (node: PlanNode) => node.type !== 'text' && node.type !== 'hardBreak';
  return nodes.filter(isBlock).flatMap((node) => {
    const own = textOf(node);
    const line = `${'  '.repeat(depth)}${node.type}${own ? `: ${own}` : ''}`;
    return [line, ...outline(node.content, depth + 1)];
  });
}

describe("Notion's HTML pages", () => {
  it('reads cells as Notion writes them', () => {
    expect(cell(`${select('Urgent')}${select('Phone')}`)).toBe('Urgent, Phone');
    expect(cell('<span class="status-value"><div class="status-dot"></div>Done</span>')).toBe(
      'Done',
    );
    expect(cell('<span class="user"><span class="icon user-icon">S</span>Sam Ortiz</span>')).toBe(
      'Sam Ortiz',
    );
    expect(cell('<span class="user">@Sam Ortiz</span>, <span class="user">@Kim Lee</span>')).toBe(
      'Sam Ortiz, Kim Lee',
    );
    expect(cell('<time>@October 30, 2026</time>')).toBe('October 30, 2026');
    expect(cell('Call on <time>@October 30, 2026</time> first')).toBe(
      'Call on @October 30, 2026 first',
    );
    expect(cell('<div class="checkbox checkbox-on"></div>')).toBe('Yes');
    expect(cell('<div class="checkbox checkbox-off"></div>')).toBe('No');
    expect(
      cell('<a href="a.html"><span class="icon">📄</span>Launch</a><a href="b.html">Beta</a>'),
    ).toBe('Launch, Beta');
    expect(cell(' 42 ')).toBe('42');
  });

  it("reads a database's table, the title first, and knows a page that is one", () => {
    const table =
      '<table class="collection-content"><thead><tr>' +
      `<th>${icon('Select')}Status</th><th>${icon('Title')}Name</th><th>Notes</th>` +
      '</tr></thead><tbody><tr>' +
      `<td>${select('Waiting')}</td><td class="cell-title"><a href="Calls/Call%20Kim.html">Call Kim</a></td><td>Twice</td>` +
      '</tr></tbody></table>';
    const database = readNotionPage(notionPage('Callbacks', `${table}<br/><br/>`));
    expect(database.isDatabase).toBe(true);
    expect(database.tables).toEqual([
      {
        title: null,
        columns: [
          { name: 'Name', type: 'title' },
          { name: 'Status', type: 'select' },
          { name: 'Notes', type: null },
        ],
        rows: [{ cells: ['Call Kim', 'Waiting', 'Twice'], href: 'Calls/Call%20Kim.html' }],
      },
    ]);
    expect(database.content).toContain('href="#notion-table-0"');

    const inline = readNotionPage(
      notionPage(
        'Desk',
        `<p>Today</p><div class="collection-content"><h4 class="collection-title">Shifts</h4>${table}</div>`,
      ),
    );
    expect(inline.isDatabase).toBe(false);
    expect(inline.tables[0]?.title).toBe('Shifts');
    expect(tableOf('#notion-table-0')).toBe(0);
    expect(tableOf('#notion-table-x')).toBeNull();
  });

  it("reads a row's page: its title and properties with their types", () => {
    const properties =
      `<tr class="property-row property-row-multi_select"><th>${icon('MultipleSelect')}Tags</th><td>${select('Urgent')}</td></tr>` +
      `<tr class="property-row property-row-formula"><th>Days open</th><td>3</td></tr>` +
      `<tr class="property-row"><th>${icon('PhoneNumber')}Phone</th><td>555-0100</td></tr>` +
      `<tr class="property-row property-row-constructor"><th>Odd</th><td>x</td></tr>`;
    const page = readNotionPage(notionPage('Call Kim', '<p>Called twice.</p>', properties));
    expect(page.title).toBe('Call Kim');
    expect(page.properties).toEqual([
      { name: 'Tags', type: 'multi_select', value: 'Urgent' },
      { name: 'Days open', type: 'formula', value: '3' },
      { name: 'Phone', type: 'phone', value: '555-0100' },
      { name: 'Odd', type: null, value: 'x' },
    ]);
    expect(page.content).not.toContain('Days open');
    expect(readNotionPage('<title>Plain</title><p>Text</p>').title).toBe('Plain');
  });

  it("turns Notion's blocks into what pages have", () => {
    const body = [
      '<p>Ask <span style="border-bottom:0.05em solid">first</span>, then <span class="user"><span class="icon user-icon">S</span>@Sam Ortiz</span>.</p>',
      '<ul class="bulleted-list"><li>Wash hands</li></ul><ul class="bulleted-list"><li>Check the list</li></ul>',
      '<ol type="1" class="numbered-list" start="1"><li>Greet</li></ol>',
      '<ol type="1" class="numbered-list" start="2"><li>Log the call</li></ol>',
      '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Book the room</span><div class="indented"></div></li></ul>',
      '<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span>Order gloves</span></li></ul>',
      '<figure class="callout"><div style="font-size:1.5em"><span class="icon">💡</span></div><div style="width:100%">Ask before you call.</div></figure>',
      '<figure class="link-to-page"><a href="Intake.html"><span class="icon">📄</span>Intake</a></figure>',
      '<figure class="equation"><style>@import url(katex.css)</style><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">a^2 + b^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">a2+b2</span></span></span></div></figure>',
      '<p>Rate <span class="notion-text-equation-token"><span class="katex"><span class="katex-mathml"><annotation encoding="application/x-tex">x</annotation></span><span class="katex-html">x</span></span></span> each.</p>',
      '<figure><a href="https://example.org/guide" class="bookmark source"><div class="bookmark-info"><div class="bookmark-title">Front desk guide</div><div class="bookmark-description">How we work</div><div class="bookmark-href"><img src="https://example.org/favicon.ico" class="icon bookmark-icon"/>https://example.org/guide</div></div></a></figure>',
    ].join('');
    const page = readNotionPage(notionPage('Desk', body));
    expect(page.equations).toBe(2);
    const { content, problems } = htmlToContent(page.content, {
      source: 'Desk.html',
      link: (href) => href,
    });
    const doc = 'doc' in content ? content.doc : undefined;
    expect(outline(doc?.content)).toEqual([
      'paragraph: Ask first, then @Sam Ortiz.',
      'bulletList',
      '  listItem',
      '    paragraph: Wash hands',
      '  listItem',
      '    paragraph: Check the list',
      'orderedList',
      '  listItem',
      '    paragraph: Greet',
      '  listItem',
      '    paragraph: Log the call',
      'taskList',
      '  taskItem',
      '    paragraph: Book the room',
      '  taskItem',
      '    paragraph: Order gloves',
      'blockquote',
      '  paragraph: 💡 Ask before you call.',
      'paragraph: Intake',
      'codeBlock: a^2 + b^2',
      'paragraph: Rate x each.',
      'paragraph: Front desk guide',
    ]);
    const marks = JSON.stringify(doc);
    expect(marks).toContain('"underline"');
    expect(marks).toContain('"checked":true');
    expect(marks).toContain('"checked":false');
    expect(marks).toContain('"href":"https://example.org/guide"');
    expect(problems.map((problem) => problem.what)).toEqual(['1 callout kept as a quote']);
  });
});
