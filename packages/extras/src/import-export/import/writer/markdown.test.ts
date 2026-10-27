import { describe, expect, it } from 'vitest';
import { escapeMarkdown, markdownHref, markdownLink, oneLine, plainTextMarkdown } from './markdown';

describe('importer Markdown', () => {
  it('escapes what Markdown would read as formatting', () => {
    expect(escapeMarkdown('Find the *number* [now] & `call` #2 <b>')).toBe(
      'Find the \\*number\\* \\[now\\] \\& \\`call\\` \\#2 \\<b\\>',
    );
    expect(oneLine(' Book\n  a room ')).toBe('Book a room');
  });

  it('keeps plain text as typed: its lines, its paragraphs, and nothing as formatting', () => {
    const notes =
      '  Ask about *Tuesday*.\r\n- not a list\n2. not a list\n\n\n# not a heading\n===\n';
    expect(plainTextMarkdown(notes)).toBe(
      [
        'Ask about \\*Tuesday\\*.\\',
        '\\- not a list\\',
        '2\\. not a list',
        '',
        '\\# not a heading\\',
        '\\===',
      ].join('\n'),
    );
    expect(plainTextMarkdown(' \n\n ')).toBe('');
  });

  it('writes links whose address cannot end early or start another link', () => {
    expect(markdownHref('https://example.test/a b(c)<d>\\e?q=%20')).toBe(
      'https://example.test/a%20b%28c%29%3Cd%3E%5Ce?q=%20',
    );
    expect(
      markdownLink('Visit [notes]', 'https://example.test/x) [Sign in](https://evil.test'),
    ).toBe('[Visit \\[notes\\]](https://example.test/x%29%20[Sign%20in]%28https://evil.test)');
  });
});
