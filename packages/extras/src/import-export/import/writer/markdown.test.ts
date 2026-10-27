import { describe, expect, it } from 'vitest';
import { escapeMarkdown, markdownHref, markdownLink, oneLine } from './markdown';

describe('importer Markdown', () => {
  it('escapes what Markdown would read as formatting', () => {
    expect(escapeMarkdown('Find the *number* [now] & `call` #2 <b>')).toBe(
      'Find the \\*number\\* \\[now\\] \\& \\`call\\` \\#2 \\<b\\>',
    );
    expect(oneLine(' Book\n  a room ')).toBe('Book a room');
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
