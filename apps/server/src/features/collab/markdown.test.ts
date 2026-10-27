import { describe, expect, it } from 'vitest';
import { pageSchemaInfo, type SchemaInfo } from './check';
import { fitToSchema, fromMarkdown, toMarkdown } from './markdown';
import type { PageMark, PageNode } from './ydoc';

const info = pageSchemaInfo();

const bold = { type: 'bold' };
const italic = { type: 'italic' };
const code = { type: 'code' };
const link = (href: string): PageMark => ({ type: 'link', attrs: { href } });

const text = (value: string, ...marks: PageMark[]): PageNode =>
  marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const paragraph = (...content: PageNode[]): PageNode =>
  content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
const item = (...content: PageNode[]): PageNode => ({ type: 'listItem', content });
const task = (checked: boolean, ...content: PageNode[]): PageNode => ({
  type: 'taskItem',
  attrs: { checked },
  content,
});

const page: PageNode[] = [
  { type: 'heading', attrs: { level: 2 }, content: [text('Shift handover')] },
  paragraph(
    text('Refunds go out on '),
    text('Fridays', bold),
    text(', see '),
    text('the guide', link('https://example.test/refunds')),
    text(' or run '),
    text('npm run refunds', code),
    text('.'),
  ),
  paragraph(text('1. Not a list, # not a heading, *not* emphasis')),
  {
    type: 'bulletList',
    content: [
      item(paragraph(text('Ward A')), {
        type: 'bulletList',
        content: [item(paragraph(text('Room 12')))],
      }),
      item(paragraph(text('Ward B'))),
    ],
  },
  {
    type: 'orderedList',
    attrs: { start: 3 },
    content: [item(paragraph(text('Third'))), item(paragraph(text('Fourth')))],
  },
  {
    type: 'taskList',
    content: [
      task(true, paragraph(text('Call the family'))),
      task(false, paragraph(text('Book transport'))),
    ],
  },
  { type: 'blockquote', content: [paragraph(text('Ask before visiting.', italic))] },
  { type: 'codeBlock', attrs: { language: 'sh' }, content: [text('echo "```"')] },
  { type: 'horizontalRule' },
];

const EXPECTED = `## Shift handover

Refunds go out on **Fridays**, see [the guide](<https://example.test/refunds>) or run \`npm run refunds\`.

1\\. Not a list, \\# not a heading, \\*not\\* emphasis

- Ward A

  - Room 12
- Ward B

3. Third
4. Fourth

- [x] Call the family
- [ ] Book transport

> *Ask before visiting.*

\`\`\`\`sh
echo "\`\`\`"
\`\`\`\`

---
`;

describe('Markdown export', () => {
  it('writes blocks the way people write Markdown', () => {
    expect(toMarkdown(page, info)).toBe(EXPECTED);
    expect(toMarkdown([], info)).toBe('');
  });

  it('reads back what it writes', () => {
    expect(fitToSchema(fromMarkdown(toMarkdown(page, info), info))).toEqual(fitToSchema(page));
  });

  it('uses HTML where Markdown has no syntax or would read differently', () => {
    // `**` can't close between a full stop and a letter, so this bold needs a tag.
    const nodes = [
      paragraph(text('a'), text('b.', bold), text('c '), text('under', { type: 'underline' })),
      paragraph(text('Line one'), { type: 'hardBreak' }, text('- line two')),
    ];
    const markdown = toMarkdown(nodes, info);
    expect(markdown).toBe('a<strong>b.</strong>c <u>under</u>\n\nLine one<br>- line two\n');
    expect(fromMarkdown(markdown, info)).toEqual(nodes);
  });

  it('keeps neighbouring lists apart', () => {
    const nodes: PageNode[] = [
      { type: 'bulletList', content: [item(paragraph(text('Ward A')))] },
      { type: 'bulletList', content: [item(paragraph(text('Ward B')))] },
      {
        type: 'taskList',
        content: [
          task(false, paragraph(), {
            type: 'taskList',
            content: [task(true, paragraph(text('Sub-task')))],
          }),
        ],
      },
    ];
    const markdown = toMarkdown(nodes, info);
    expect(markdown).toBe('- Ward A\n\n* Ward B\n\n- [ ]\n  - [x] Sub-task\n');
    expect(fromMarkdown(markdown, info)).toEqual(nodes);
  });

  it('keeps blocks and inline nodes without Markdown as comments', () => {
    const custom: SchemaInfo = {
      ...info,
      nodes: new Set([...info.nodes, 'callout', 'mention']),
      inline: new Set([...info.inline, 'mention']),
    };
    const nodes: PageNode[] = [
      {
        type: 'callout',
        attrs: { tone: 'warning', note: 'a --> b <script>' },
        content: [paragraph(text('Wet floor'))],
      },
      paragraph(
        { type: 'mention', attrs: { id: 'u1', label: 'Robin Example' } },
        text(' will call.'),
      ),
    ];
    const markdown = toMarkdown(nodes, custom);
    expect(markdown).not.toContain('<script>');
    expect(markdown.match(/-->/g)).toHaveLength(2);
    expect(fromMarkdown(markdown, custom)).toEqual(nodes);
    // A node the schema doesn't know stays as text.
    expect(fromMarkdown('<!-- carehub:block {"type":"nope"} -->\n', info)).toEqual([
      paragraph(text('<!-- carehub:block {"type":"nope"} -->')),
    ]);
  });
});

describe('Markdown import', () => {
  it('never keeps unsafe links or raw HTML', () => {
    const markdown =
      '[Open](javascript:alert(1)) <b onclick="x">hi</b>\n\n<script>alert(1)</script>\n';
    expect(fromMarkdown(markdown, info)).toEqual([
      paragraph(text('[Open](javascript:alert(1)) <b onclick="x">hi</b>')),
      paragraph(text('<script>alert(1)</script>')),
    ]);
    const strict: SchemaInfo = { ...info, isSafeUrl: () => false };
    expect(fromMarkdown('[Guide](https://example.test/guide)', strict)).toEqual([
      paragraph(text('Guide')),
    ]);
  });

  it('reads task lists; an escaped box stays text', () => {
    const markdown = '- [x] Call the family\n- [ ] Book transport\n\n* \\[ ] Bring the forms\n';
    expect(fromMarkdown(markdown, info)).toEqual([
      {
        type: 'taskList',
        content: [
          task(true, paragraph(text('Call the family'))),
          task(false, paragraph(text('Book transport'))),
        ],
      },
      { type: 'bulletList', content: [item(paragraph(text('[ ] Bring the forms')))] },
    ]);
  });

  it('reads headings past level 3 as level 3, and HTML marks as marks', () => {
    expect(fromMarkdown('#### Deep\n\n<b>Bold</b> and <s>gone</s>', info)).toEqual([
      { type: 'heading', attrs: { level: 3 }, content: [text('Deep')] },
      paragraph(text('Bold', bold), text(' and '), text('gone', { type: 'strike' })),
    ]);
  });
});

describe('fitToSchema', () => {
  it('turns blocks the schema does not allow into text', () => {
    const nodes = [
      { type: 'listItem', content: [paragraph(text('Stray item'))] },
      paragraph(text('Odd mark', { type: 'sparkle' })),
      { type: 'heading', content: [text('Title')] },
    ];
    expect(fitToSchema(nodes)).toMatchObject([
      { type: 'paragraph', content: [{ type: 'text', text: 'Stray item' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Odd mark' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
    ]);
  });
});
