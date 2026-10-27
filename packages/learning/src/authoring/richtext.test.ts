import { describe, expect, it } from 'vitest';
import { LIMITS, RichTextSchema } from '../format/index';
import type { RichText } from '../format/index';
import {
  editorToRichText,
  hrefToLink,
  isBlankRichText,
  limitRichText,
  linkToHref,
  normalizeRichText,
  richTextToEditor,
  richTextToTextarea,
  textareaToRichText,
} from './richtext';
import type { EditorJson } from './richtext';

// Fictional text only.
const plain = (...paragraphs: string[]): RichText =>
  paragraphs.map((text) => ({ runs: [{ text }] }));

describe('links', () => {
  const course = { courseId: 'course-1' };

  it('maps urls, pages and lessons to editor hrefs and back', () => {
    const links = [
      { kind: 'url', url: 'https://help.example.org/billing' },
      { kind: 'url', url: 'mailto:support@example.org' },
      { kind: 'page', pageId: 'kb-refund-policy' },
      { kind: 'lesson', lessonId: 'lesson-2' },
      { kind: 'lesson', lessonId: 'lesson-2', blockId: 'block-7' },
    ] as const;
    for (const link of links)
      expect(hrefToLink(linkToHref(link, course) ?? '', course)).toEqual(link);
    expect(linkToHref({ kind: 'page', pageId: 'kb-refund-policy' })).toBe('/p/kb-refund-policy');
    expect(linkToHref({ kind: 'lesson', lessonId: 'l1', blockId: 'b1' }, course)).toBe(
      '/learning/courses/course-1/lessons/l1#block-b1',
    );
    expect(linkToHref({ kind: 'lesson', lessonId: 'l1' }, course)).toBe(
      '/learning/courses/course-1/lessons/l1',
    );
  });

  it('needs the course for lesson links', () => {
    expect(linkToHref({ kind: 'lesson', lessonId: 'l1' })).toBeNull();
    expect(hrefToLink('/learning/courses/course-1/lessons/l1')).toBeNull();
    expect(hrefToLink('/learning/courses/course-2/lessons/l1', course)).toBeNull();
  });

  it("rejects hrefs the format can't store", () => {
    for (const href of [
      'http://example.org',
      'javascript:alert(1)',
      '/p/',
      '/p/has space',
      '/learning/courses/course-1/lessons/',
      '/learning/courses/course-1/lessons/a/b',
      '/learning/courses/course-1/lessons/bad id',
      '/learning/courses/course-1/lessons/l1#block-',
      '/learning/courses/course-1/lessons/l1#top',
      '/learning/courses/course-1/lessons/l1?tab=2',
      'ftp://x',
      '',
    ]) {
      expect(hrefToLink(href, course)).toBeNull();
    }
    expect(hrefToLink('  https://example.org/a  ')).toEqual({
      kind: 'url',
      url: 'https://example.org/a',
    });
  });
});

describe('normalizeRichText', () => {
  it('merges neighbouring runs, drops empty ones and orders marks', () => {
    const messy: RichText = [
      {
        runs: [
          { text: 'Hello ', marks: ['italic', 'bold', 'bold'] },
          { text: 'there', marks: ['bold', 'italic'] },
          { text: '' },
          { text: ', friend', marks: [] },
          { text: '!', link: { kind: 'page', pageId: 'p1' } },
        ],
      },
    ];
    expect(normalizeRichText(messy)).toEqual([
      {
        runs: [
          { text: 'Hello there', marks: ['bold', 'italic'] },
          { text: ', friend' },
          { text: '!', link: { kind: 'page', pageId: 'p1' } },
        ],
      },
    ]);
  });

  it('returns the same array when the text is already tidy', () => {
    const tidy = plain('One', 'Two');
    expect(normalizeRichText(tidy)).toBe(tidy);
  });
});

describe('isBlankRichText', () => {
  it('is true for nothing, empty paragraphs and spaces', () => {
    expect(isBlankRichText(undefined)).toBe(true);
    expect(isBlankRichText([])).toBe(true);
    expect(isBlankRichText([{ runs: [] }, { runs: [{ text: ' \n ' }] }])).toBe(true);
    expect(isBlankRichText(plain('Hi'))).toBe(false);
  });
});

describe('editor JSON', () => {
  it('writes empty text as one empty paragraph, as the editor does, and reads it back as empty', () => {
    expect(richTextToEditor([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(editorToRichText({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
    expect(editorToRichText({ type: 'doc' })).toEqual([]);
  });

  it('turns marks, links and line breaks into editor nodes', () => {
    const rt: RichText = [
      {
        runs: [
          { text: 'Call us', marks: ['bold'] },
          { text: '\nor read ' },
          { text: 'the guide', link: { kind: 'page', pageId: 'kb-1' } },
        ],
      },
      { runs: [] },
    ];
    expect(richTextToEditor(rt)).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Call us', marks: [{ type: 'bold' }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'or read ' },
            {
              type: 'text',
              text: 'the guide',
              marks: [{ type: 'link', attrs: { href: '/p/kb-1' } }],
            },
          ],
        },
        { type: 'paragraph' },
      ],
    });
  });

  it('round-trips tidy rich text exactly', () => {
    const samples: RichText[] = [
      plain('Welcome to the team.'),
      [
        { runs: [{ text: 'Line one\nline two', marks: ['bold', 'underline'] }] },
        { runs: [] },
        ...plain('After a gap'),
      ],
      [
        {
          runs: [
            { text: 'Escalate', marks: ['strike', 'code'] },
            { text: ' via ', marks: ['italic'] },
            { text: 'the form', link: { kind: 'url', url: 'https://forms.example.org/x' } },
          ],
        },
      ],
      [{ runs: [{ text: '\n\nTwo breaks first' }] }],
      [
        {
          runs: [
            {
              text: 'See lesson 2',
              link: { kind: 'lesson', lessonId: 'l2', blockId: 'b9' },
              marks: ['bold'],
            },
          ],
        },
      ],
    ];
    const course = { courseId: 'course-1' };
    for (const rt of samples)
      expect(editorToRichText(richTextToEditor(rt, course), course)).toEqual(rt);
  });

  it('keeps the text of lesson links when no course is given', () => {
    const rt: RichText = [
      {
        runs: [{ text: 'See lesson 2', marks: ['bold'], link: { kind: 'lesson', lessonId: 'l2' } }],
      },
    ];
    const doc = richTextToEditor(rt);
    expect(doc.content?.[0]?.content).toEqual([
      { type: 'text', text: 'See lesson 2', marks: [{ type: 'bold' }] },
    ]);
    const linked = richTextToEditor(rt, { courseId: 'c1' });
    expect(editorToRichText(linked)).toEqual([
      { runs: [{ text: 'See lesson 2', marks: ['bold'] }] },
    ]);
    expect(editorToRichText(linked, { courseId: 'c1' })).toEqual(rt);
  });

  it('reads what the editor writes: extra link attributes, unknown marks and nodes', () => {
    const doc: EditorJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ', marks: [{ type: 'highlight' }] },
            {
              type: 'text',
              text: 'this',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://example.org',
                    target: '_blank',
                    rel: 'noopener',
                    class: null,
                  },
                },
                { type: 'italic' },
              ],
            },
            {
              type: 'text',
              text: ' or ',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
            { type: 'hardBreak', marks: [{ type: 'bold' }] },
            { type: 'text', text: 'that' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A point' }] }],
            },
          ],
        },
        { type: 'text', text: 'Stray text' },
      ],
    };
    const rt = editorToRichText(doc);
    expect(rt).toEqual([
      {
        runs: [
          { text: 'Read ' },
          { text: 'this', marks: ['italic'], link: { kind: 'url', url: 'https://example.org' } },
          { text: ' or ' },
          { text: '\n', marks: ['bold'] },
          { text: 'that' },
        ],
      },
      { runs: [{ text: 'A point' }] },
      { runs: [{ text: 'Stray text' }] },
    ]);
    expect(RichTextSchema.safeParse(rt).success).toBe(true);
  });

  it("cuts very long pastes to the format's limits", () => {
    const long = 'a'.repeat(LIMITS.richText + 50);
    const rt = editorToRichText({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: long }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'more' }] },
      ],
    });
    expect(rt).toHaveLength(1);
    expect(rt[0]?.runs[0]?.text.length).toBe(LIMITS.richText);
    expect(RichTextSchema.safeParse(rt).success).toBe(true);
  });
});

describe('limitRichText', () => {
  it('keeps text under the limits unchanged and caps paragraphs and runs', () => {
    expect(limitRichText(plain('a', 'b'))).toEqual(plain('a', 'b'));
    const many = Array.from({ length: LIMITS.paragraphs + 5 }, () => ({ runs: [{ text: 'x' }] }));
    expect(limitRichText(many)).toHaveLength(LIMITS.paragraphs);
    const runs = Array.from(
      { length: LIMITS.runsPerParagraph + 2 },
      (_, i): RichText[number]['runs'][number] =>
        i % 2 ? { text: 'y', marks: ['bold'] } : { text: 'y' },
    );
    const capped = limitRichText([{ runs }]);
    expect(capped[0]?.runs).toHaveLength(LIMITS.runsPerParagraph);
    expect(capped[0]?.runs.at(-1)).toEqual({ text: 'yyy' });
  });
});

describe('text area', () => {
  it('separates paragraphs with a blank line and keeps line breaks', () => {
    const rt: RichText = [
      { runs: [{ text: 'Hello', marks: ['bold'] }, { text: ' team\nsecond line' }] },
      ...plain('Next'),
    ];
    expect(richTextToTextarea(rt)).toBe('Hello team\nsecond line\n\nNext');
    expect(textareaToRichText('Hello team\r\nsecond line\n \n\n\nNext\n\n')).toEqual([
      ...plain('Hello team\nsecond line', 'Next'),
    ]);
    expect(textareaToRichText('')).toEqual([]);
  });

  it("keeps the formatting of paragraphs whose text didn't change", () => {
    const before: RichText = [{ runs: [{ text: 'Be kind', marks: ['bold'] }] }, ...plain('Old')];
    expect(textareaToRichText('Be kind\n\nNew', before)).toEqual([
      { runs: [{ text: 'Be kind', marks: ['bold'] }] },
      ...plain('New'),
    ]);
  });

  it('turns line breaks into spaces for one-line fields', () => {
    expect(textareaToRichText('One\n\ntwo\nthree', [], { singleLine: true })).toEqual(
      plain('One two three'),
    );
  });
});
