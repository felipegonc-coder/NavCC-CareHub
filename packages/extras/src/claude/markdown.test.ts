import { describe, expect, it } from 'vitest';
import { blocksText, claudeHref, markdownToBlocks, singleParagraph } from './markdown';

const text = (value: string, marks?: unknown[]) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const paragraph = (...content: unknown[]) =>
  content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
const bold = { type: 'bold' };
const italic = { type: 'italic' };
const link = (href: string) => ({ type: 'link', attrs: { href } });

describe('Claude answers as page blocks', () => {
  it('turns an empty answer into no blocks', () => {
    expect(markdownToBlocks('')).toEqual([]);
    expect(markdownToBlocks('\n  \n')).toEqual([]);
  });

  it('keeps paragraphs, with single line breaks as line breaks', () => {
    expect(
      markdownToBlocks('Refunds take 5 days.\nAsk Sam first.\n\nThen close the ticket.'),
    ).toEqual([
      paragraph(text('Refunds take 5 days.'), { type: 'hardBreak' }, text('Ask Sam first.')),
      paragraph(text('Then close the ticket.')),
    ]);
  });

  it('keeps bold, italic, strikethrough and code', () => {
    expect(markdownToBlocks('**Note:** call *within* a day, ~~not~~ `today`.')).toEqual([
      paragraph(
        text('Note:', [bold]),
        text(' call '),
        text('within', [italic]),
        text(' a day, '),
        text('not', [{ type: 'strike' }]),
        text(' '),
        text('today', [{ type: 'code' }]),
        text('.'),
      ),
    ]);
  });

  it('nests emphasis and leaves stray stars and snake_case alone', () => {
    expect(markdownToBlocks('*one **two** three*')).toEqual([
      paragraph(text('one ', [italic]), text('two', [italic, bold]), text(' three', [italic])),
    ]);
    expect(markdownToBlocks('***both***')).toEqual([paragraph(text('both', [bold, italic]))]);
    expect(markdownToBlocks('2 * 3 * 4 and ticket_queue_name')).toEqual([
      paragraph(text('2 * 3 * 4 and ticket_queue_name')),
    ]);
    expect(markdownToBlocks('\\*not italic\\*')).toEqual([paragraph(text('*not italic*'))]);
  });

  it('leaves marks that never close as they are, and marks links inside bold', () => {
    expect(markdownToBlocks('**not closed and `no code')).toEqual([
      paragraph(text('**not closed and `no code')),
    ]);
    expect(markdownToBlocks('**[Refund steps](/p/0f3c)**')).toEqual([
      paragraph(text('Refund steps', [bold, link('/p/0f3c')])),
    ]);
  });

  it('reads very deep nesting as plain text instead of failing', () => {
    const quotes = markdownToBlocks(`${'> '.repeat(40)}deep`);
    expect(blocksText(quotes)).toMatch(/> deep$/);
    const stars = markdownToBlocks(`${'*a '.repeat(30)}b${' c*'.repeat(30)}`);
    expect(blocksText(stars)).toContain('b');
  });

  it('keeps web, email and Care Hub page links and drops the rest', () => {
    expect(
      markdownToBlocks(
        '[Refund steps](/p/0f3c) and [help](https://help.example.com/a "Help") or <mailto:avery@example.com>',
      ),
    ).toEqual([
      paragraph(
        text('Refund steps', [link('/p/0f3c')]),
        text(' and '),
        text('help', [link('https://help.example.com/a')]),
        text(' or '),
        text('mailto:avery@example.com', [link('mailto:avery@example.com')]),
      ),
    ]);
    expect(markdownToBlocks('[click](javascript:void(0)) [x](data:text/html,hi)')).toEqual([
      paragraph(text('click) x')),
    ]);
  });

  it('turns pictures into their words and HTML into plain text', () => {
    expect(markdownToBlocks('![A refund form](https://example.com/form.png)')).toEqual([
      paragraph(text('A refund form')),
    ]);
    expect(markdownToBlocks('<b>Hi</b> <img src=x onerror=alert(1)>')).toEqual([
      paragraph(text('<b>Hi</b> <img src=x onerror=alert(1)>')),
    ]);
  });

  it('keeps headings, with levels 4 to 6 as level 3', () => {
    expect(markdownToBlocks('# Refunds\n## Steps ##\n#### Small\n# C#')).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [text('Refunds')] },
      { type: 'heading', attrs: { level: 2 }, content: [text('Steps')] },
      { type: 'heading', attrs: { level: 3 }, content: [text('Small')] },
      { type: 'heading', attrs: { level: 1 }, content: [text('C#')] },
    ]);
  });

  it('keeps bullet, numbered and nested lists', () => {
    expect(
      markdownToBlocks('- Check the order\n- Refund it\n  - Card: 5 days\n  - Cash: today'),
    ).toEqual([
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [paragraph(text('Check the order'))] },
          {
            type: 'listItem',
            content: [
              paragraph(text('Refund it')),
              {
                type: 'bulletList',
                content: [
                  { type: 'listItem', content: [paragraph(text('Card: 5 days'))] },
                  { type: 'listItem', content: [paragraph(text('Cash: today'))] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(markdownToBlocks('3. Third\n4. Fourth')).toEqual([
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          { type: 'listItem', content: [paragraph(text('Third'))] },
          { type: 'listItem', content: [paragraph(text('Fourth'))] },
        ],
      },
    ]);
  });

  it('keeps to-dos with their ticks', () => {
    expect(markdownToBlocks('- [x] Email Avery\n- [ ] Close the ticket')).toEqual([
      {
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [paragraph(text('Email Avery'))] },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [paragraph(text('Close the ticket'))],
          },
        ],
      },
    ]);
  });

  it('ends a paragraph at a bullet but not at a number in a sentence', () => {
    expect(markdownToBlocks('Do this:\n- Call')).toEqual([
      paragraph(text('Do this:')),
      { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph(text('Call'))] }] },
    ]);
    expect(markdownToBlocks('We waited until\n2. Then we left')).toEqual([
      paragraph(text('We waited until'), { type: 'hardBreak' }, text('2. Then we left')),
    ]);
  });

  it('keeps quotes, dividers and code blocks, with code as plain text', () => {
    expect(
      markdownToBlocks('> Be kind\n> and quick\n\n---\n\n```js\nconst a = "**x**";\n```'),
    ).toEqual([
      {
        type: 'blockquote',
        content: [paragraph(text('Be kind'), { type: 'hardBreak' }, text('and quick'))],
      },
      { type: 'horizontalRule' },
      { type: 'codeBlock', content: [text('const a = "**x**";')] },
    ]);
  });

  it('reads the words of the blocks, one per line', () => {
    const blocks = markdownToBlocks(
      '# Steps\n\n1. **Check** the order\n2. Refund it\n\n---\n\nDone.',
    );
    expect(blocksText(blocks)).toBe('Steps\nCheck the order\nRefund it\nDone.');
  });

  it('gives inline content only for one plain paragraph', () => {
    expect(singleParagraph(markdownToBlocks('A **short** note.'))).toEqual([
      text('A '),
      text('short', [bold]),
      text(' note.'),
    ]);
    expect(singleParagraph(markdownToBlocks('One.\n\nTwo.'))).toBeNull();
    expect(singleParagraph(markdownToBlocks('- One'))).toBeNull();
  });
});

describe('links Claude may add', () => {
  it('allows web addresses with a host, email and Care Hub pages', () => {
    expect(claudeHref('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(claudeHref(' http://example.com ')).toBe('http://example.com');
    expect(claudeHref('https://help.example.com:8443/a-b#c')).toBe(
      'https://help.example.com:8443/a-b#c',
    );
    expect(claudeHref('mailto:sam@example.com')).toBe('mailto:sam@example.com');
    expect(claudeHref('/p/3f2a-11#steps')).toBe('/p/3f2a-11#steps');
  });

  it('refuses scripts, data, passwords and other places', () => {
    for (const href of [
      'javascript:alert(1)',
      'JAVASCRIPT:alert(1)',
      'data:text/html,hi',
      'vbscript:x',
      'https://avery:secret@example.com',
      'https://',
      '//example.com',
      '/settings',
      'file:///etc/passwd',
      'ftp://example.com',
      'https://example.com@evil.example',
      'https://exa mple.com',
    ]) {
      expect(claudeHref(href)).toBeNull();
    }
  });
});
