import { describe, expect, it } from 'vitest';
import { pageSchemaInfo, type SchemaInfo } from './check';
import { fitToSchema, fromMarkdown, toMarkdown } from './markdown';
import type { PageMark, PageNode } from './ydoc';

const info = pageSchemaInfo();
/** The page schema with nodes it doesn't have yet. */
const custom: SchemaInfo = {
  ...info,
  nodes: new Set([...info.nodes, 'callout', 'image', 'mention']),
  inline: new Set([...info.inline, 'mention']),
  nodeAttrs: new Map<string, ReadonlySet<string>>([
    ...info.nodeAttrs,
    ['callout', new Set(['tone', 'note'])],
    ['image', new Set(['src', 'alt'])],
    ['mention', new Set(['id', 'label'])],
  ]),
};

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

  it('moves spaces past closing marks in linear time', () => {
    const words = Array.from({ length: 100 }, (_, index) => [
      text(' '),
      text(`word${index}`, bold),
    ]);
    const nodes = [paragraph(text(`Start${' '.repeat(20_000)}`), ...words.flat().slice(1))];
    const started = performance.now();
    const markdown = toMarkdown(nodes, info);
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(markdown.endsWith(' **word98** **word99**\n')).toBe(true);
    expect(fromMarkdown(markdown, info)).toEqual(nodes);
  });

  it('keeps deep nesting and long code in lists within a small multiple of the page', () => {
    const code: PageNode = { type: 'codeBlock', content: [text('x\n'.repeat(100_000).trimEnd())] };
    const quote = (levels: number): PageNode =>
      levels === 0
        ? code
        : { type: 'blockquote', content: [paragraph(text(`Level ${levels}`)), quote(levels - 1)] };
    const listed: PageNode = { type: 'orderedList', content: [item(paragraph(text('Run')), code)] };
    // Past eight levels, and code whose indent would more than double it: one comment each.
    for (const nodes of [[quote(100)], [listed]]) {
      const markdown = toMarkdown(nodes, info);
      expect(markdown.length).toBeLessThan(2 * JSON.stringify(nodes).length);
      expect(markdown.match(/carehub:block/g)).toHaveLength(1);
    }
    for (const nodes of [[quote(12)], [listed]]) {
      expect(fromMarkdown(toMarkdown(nodes, info), info)).toEqual(nodes);
    }
  });

  it('keeps list numbers to the nine digits Markdown reads', () => {
    const list = (start: number): PageNode => ({
      type: 'orderedList',
      attrs: { start },
      content: [item(paragraph(text('One'))), item(paragraph(text('Two')))],
    });
    expect(toMarkdown([list(5e9)], info)).toBe('999999998. One\n999999999. Two\n');
    expect(toMarkdown([list(-3)], info)).toBe('0. One\n1. Two\n');
    expect(fromMarkdown('0. One\n1. Two\n', info)).toEqual([list(0)]);
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

  it('keeps only what the schema defines from comments', () => {
    const comment = (node: object) => `<!-- carehub:block ${JSON.stringify(node)} -->`;
    const callout = { type: 'callout', attrs: { tone: 'warning' }, content: [paragraph()] };
    const extra = { ...callout, attrs: { tone: 'warning', onclick: 'alert(1)' } };
    expect(fromMarkdown(comment(extra), custom)).toEqual([callout]);
    // An unsafe address in a node leaves the comment as text.
    const image = comment({ type: 'image', attrs: { src: 'javascript:alert(1)', alt: 'Map' } });
    expect(fromMarkdown(image, custom)).toEqual([paragraph(text(image))]);
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
