import { describe, expect, it } from 'vitest';
import type { ContentNode } from './content';
import { pageToMarkdown } from './markdown';
import { exportHref, type ExportLinks } from './render';

// Fictional pages: "Escalation steps" is in the export, "Team handbook" is only openable, and
// "Payroll" can't be opened.
const STEPS = '11111111-1111-4111-8111-111111111111';
const HANDBOOK = '22222222-2222-4222-8222-222222222222';
const PAYROLL = '33333333-3333-4333-8333-333333333333';
const CHART = '44444444-4444-4444-8444-444444444444';

const links: ExportLinks = {
  page: (id) =>
    id === STEPS
      ? { title: 'Escalation steps', href: 'Intake%20guide/Escalation%20steps.md' }
      : id === HANDBOOK
        ? { title: 'Team handbook', href: `https://care.example.test/p/${HANDBOOK}` }
        : null,
  file: (id) => (id === CHART ? { name: 'chart.png', href: 'Intake%20guide/chart.png' } : null),
  href: (href) => exportHref(href, 'https://care.example.test'),
};

const text = (value: string, ...marks: ContentNode['marks'] & object): ContentNode => ({
  type: 'text',
  text: value,
  ...(marks.length > 0 ? { marks } : {}),
});
const p = (...content: ContentNode[]): ContentNode => ({ type: 'paragraph', content });
const md = (...blocks: ContentNode[]) =>
  pageToMarkdown({ title: 'Intake guide', blocks }, links).split('\n').slice(2).join('\n');

describe('pageToMarkdown', () => {
  it('starts with the title as a heading, then the properties as "Name: value" lines', () => {
    const page = pageToMarkdown(
      {
        title: 'Call Rowan',
        properties: [
          { name: 'Status', value: 'Open' },
          { name: 'Owner', value: 'Avery Lin' },
        ],
        blocks: [p(text('Ask about the new address.'))],
      },
      links,
    );
    expect(page).toBe(
      '# Call Rowan\n\nStatus: Open\nOwner: Avery Lin\n\nAsk about the new address.\n',
    );
    expect(pageToMarkdown({ title: '  ', blocks: [] }, links)).toBe('# Untitled\n');
  });

  it('writes marks, merging neighbours and keeping spaces outside the delimiters', () => {
    const bold = { type: 'bold' };
    const italic = { type: 'italic' };
    expect(
      md(
        p(
          text('Call '),
          text('within ', bold),
          text('two', bold, italic),
          text(' days', bold),
          text('.'),
        ),
      ),
    ).toBe('Call **within *two* days**.\n');
    expect(md(p(text('Run '), text('npm `ci`', { type: 'code' })))).toBe('Run `` npm `ci` ``\n');
    expect(
      md(p(text('gone', { type: 'strike' }), text(' and '), text('kept', { type: 'underline' }))),
    ).toBe('~~gone~~ and kept\n');
  });

  it('escapes characters Markdown would read as formatting', () => {
    expect(md(p(text('2 * 3 = [six] _ok_ <b> | $5')))).toBe(
      '2 \\* 3 = \\[six\\] \\_ok\\_ \\<b\\> \\| \\$5\n',
    );
    expect(md(p(text('# not a heading')), p(text('1. not a list')), p(text('- nor this')))).toBe(
      '\\# not a heading\n\n1\\. not a list\n\n\\- nor this\n',
    );
  });

  it('writes links to exported pages as relative links, others as Care Hub links, and drops unsafe ones', () => {
    const linkTo = (href: string) => ({ type: 'link', attrs: { href } });
    expect(md(p(text('See '), text('the steps', linkTo(`/p/${STEPS}`))))).toBe(
      'See [the steps](Intake%20guide/Escalation%20steps.md)\n',
    );
    expect(md(p(text('handbook', linkTo(`/p/${HANDBOOK}`))))).toBe(
      `[handbook](https://care.example.test/p/${HANDBOOK})\n`,
    );
    expect(md(p(text('secret', linkTo(`/p/${PAYROLL}`))))).toBe('secret\n');
    expect(md(p(text('web', linkTo('https://example.test/a'))))).toBe(
      '[web](https://example.test/a)\n',
    );
    expect(md(p(text('bad', linkTo('javascript:alert(1)'))))).toBe('bad\n');
    expect(md(p(text('app', linkTo('/settings'))))).toBe(
      '[app](https://care.example.test/settings)\n',
    );
  });

  it('writes page mentions from what the exporter can open, never from the saved label', () => {
    const mention = (id: string) => ({
      type: 'mention',
      attrs: { kind: 'page', id, label: 'Payroll 2026' },
    });
    expect(md(p(text('Next: '), mention(STEPS)))).toBe(
      'Next: [Escalation steps](Intake%20guide/Escalation%20steps.md)\n',
    );
    expect(md(p(mention(PAYROLL)))).toBe('No access\n');
    expect(md(p({ type: 'mention', attrs: { kind: 'user', id: 'u1', label: 'Sam Ortiz' } }))).toBe(
      '@Sam Ortiz\n',
    );
  });

  it('writes headings, lists, tasks, quotes, rules and code', () => {
    const item = (...content: ContentNode[]): ContentNode => ({ type: 'listItem', content });
    const out = md(
      { type: 'heading', attrs: { level: 2 }, content: [text('Before the call')] },
      {
        type: 'bulletList',
        content: [
          item(p(text('Check the chart')), {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [item(p(text('Allergies'))), item(p(text('Medicines')))],
          }),
          item(p(text('Confirm the address'))),
        ],
      },
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [p(text('Called'))] },
          { type: 'taskItem', attrs: { checked: false }, content: [p(text('Wrote notes'))] },
        ],
      },
      { type: 'blockquote', content: [p(text('Be kind.')), p(text('Be brief.'))] },
      { type: 'horizontalRule' },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = "```";')] },
    );
    expect(out).toBe(
      [
        '## Before the call',
        '',
        '- Check the chart',
        '',
        '  3. Allergies',
        '  4. Medicines',
        '- Confirm the address',
        '',
        '- [x] Called',
        '- [ ] Wrote notes',
        '',
        '> Be kind.',
        '>',
        '> Be brief.',
        '',
        '---',
        '',
        '````ts',
        'const a = "```";',
        '````',
        '',
      ].join('\n'),
    );
  });

  it('writes toggles as bullets with their content indented and callouts as quotes starting with the icon', () => {
    const out = md(
      {
        type: 'toggle',
        content: [
          { type: 'toggleSummary', content: [text('If they ask for a refund')] },
          {
            type: 'toggleContent',
            content: [p(text('Send the form.')), p(text('Note the date.'))],
          },
        ],
      },
      {
        type: 'callout',
        attrs: { icon: { type: 'emoji', emoji: '⚠️' } },
        content: [p(text('Never share passwords.'))],
      },
      { type: 'callout', content: [p(text('Tip'))] },
    );
    expect(out).toBe(
      [
        '- If they ask for a refund',
        '',
        '  Send the form.',
        '',
        '  Note the date.',
        '',
        '> ⚠️ Never share passwords.',
        '',
        '> 💡 Tip',
        '',
      ].join('\n'),
    );
  });

  it('writes columns and synced blocks as their content one after another', () => {
    const out = md(
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [p(text('Left'))] },
          { type: 'column', content: [p(text('Right'))] },
        ],
      },
      { type: 'syncedBlock', content: [p(text('Shared'))] },
    );
    expect(out).toBe('Left\n\nRight\n\nShared\n');
  });

  it('writes equations as TeX between $$, and tables with a header row', () => {
    const cell = (value: string): ContentNode => ({ type: 'tableCell', content: [p(text(value))] });
    const row = (...cells: ContentNode[]): ContentNode => ({ type: 'tableRow', content: cells });
    const out = md(
      { type: 'mathBlock', attrs: { latex: 'a^2 + b^2 = c^2' } },
      p(text('So '), { type: 'inlineMath', attrs: { latex: 'x_1' } }, text('.')),
      {
        type: 'table',
        content: [row(cell('Name'), cell('Phone')), row(cell('Rowan | home'), cell('555-0100'))],
      },
    );
    expect(out).toBe(
      [
        '$$',
        'a^2 + b^2 = c^2',
        '$$',
        '',
        'So $x_1$.',
        '',
        '| Name | Phone |',
        '| --- | --- |',
        '| Rowan \\| home | 555-0100 |',
        '',
      ].join('\n'),
    );
  });

  it('writes pictures, files and sub-pages as relative links, and says when a picture is left out', () => {
    const out = md(
      { type: 'image', attrs: { fileId: CHART, alt: 'Intake chart', caption: 'Week 1' } },
      { type: 'image', attrs: { src: `/api/files/${PAYROLL}` } },
      { type: 'file', attrs: { fileId: CHART, name: 'chart.png' } },
      { type: 'subPage', attrs: { pageId: STEPS } },
      { type: 'subPage', attrs: { pageId: PAYROLL } },
      { type: 'embed', attrs: { url: 'https://video.example.test/v/1', title: 'Training video' } },
      { type: 'tableOfContents' },
    );
    expect(out).toBe(
      [
        '![Intake chart](Intake%20guide/chart.png)',
        '',
        '*Week 1*',
        '',
        '*Picture not included*',
        '',
        '[chart.png](Intake%20guide/chart.png)',
        '',
        '[Escalation steps](Intake%20guide/Escalation%20steps.md)',
        '',
        '[Training video](https://video.example.test/v/1)',
        '',
      ].join('\n'),
    );
  });

  it('shows the content of blocks it does not know, and keeps hard breaks', () => {
    expect(
      md({
        type: 'futureBlock',
        content: [text('Line one'), { type: 'hardBreak' }, text('Line two')],
      }),
    ).toBe('Line one\\\nLine two\n');
  });
});
