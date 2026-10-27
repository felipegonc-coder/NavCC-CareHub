// @vitest-environment node
import { getSchema, type JSONContent } from '@tiptap/core';
import { Fragment, Slice } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { flattenSlice, richTextExtensions, toSingleLine } from '../src/richtext';
import { RICH_TEXT_MARKS, sanitizeRichText } from '../src/richtext-value';
import { sanitizeRichText as sanitizeFromSchema } from '../src/schema';

const all = { marks: RICH_TEXT_MARKS, singleLine: false };
const text = (value: string, marks?: JSONContent['marks']): JSONContent =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value };
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const p = (...content: JSONContent[]): JSONContent =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };

describe('sanitizeRichText', () => {
  it('keeps paragraphs, hard breaks and allowed marks', () => {
    const value = doc(p(text('Wash ', [{ type: 'bold' }]), { type: 'hardBreak' }, text('hands')));
    expect(sanitizeRichText(value, all)).toEqual(value);
  });

  it('turns other blocks into paragraphs and drops what a field cannot hold', () => {
    const value = doc(
      { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(text('One')), p(text('Two'))] }],
      },
      { type: 'horizontalRule' },
      p(text('Hi', [{ type: 'highlight' }, { type: 'italic' }, { type: 'italic' }])),
    );
    expect(sanitizeRichText(value, all)).toEqual(
      doc(p(text('Title')), p(text('One')), p(text('Two')), p(text('Hi', [{ type: 'italic' }]))),
    );
  });

  it('keeps only the allowed marks and safe links, with just their href', () => {
    const value = doc(
      p(
        text('a', [{ type: 'bold' }, { type: 'link', attrs: { href: 'javascript:alert(1)' } }]),
        text('b', [{ type: 'link', attrs: { href: '/p/1', target: '_self', onclick: 'x' } }]),
        text('c', [{ type: 'link', attrs: { href: '//care.example.org', rel: 'opener' } }]),
        text('d', [{ type: 'link', attrs: { target: '_blank' } }]),
      ),
    );
    expect(sanitizeRichText(value, { marks: ['link'], singleLine: false })).toEqual(
      doc(
        p(
          text('a'),
          text('b', [{ type: 'link', attrs: { href: '/p/1' } }]),
          text('c', [{ type: 'link', attrs: { href: 'https://care.example.org' } }]),
          text('d'),
        ),
      ),
    );
  });

  it('drops a link that is only safe before its href is trimmed', () => {
    const href = '\u00a0javascript:alert(document.cookie)';
    const value = doc(p(text('Rota', [{ type: 'link', attrs: { href } }])));
    expect(sanitizeRichText(value, all)).toEqual(doc(p(text('Rota'))));
  });

  it('puts everything on one line for single-line fields', () => {
    const value = doc(p(text('One'), { type: 'hardBreak' }, text('two')), p(), p(text('three')));
    expect(sanitizeRichText(value, { marks: RICH_TEXT_MARKS, singleLine: true })).toEqual(
      doc(p(text('One two three'))),
    );
  });

  it.each([null, undefined, 'text', 42, {}, { type: 'paragraph' }, { type: 'doc' }])(
    'gives an empty paragraph for %j',
    (value) => {
      expect(sanitizeRichText(value, all)).toEqual(doc(p()));
    },
  );

  it('drops what is nested too deep, instead of running out of stack', () => {
    let block: JSONContent = p(text('Deep'));
    let span: JSONContent = text('deep');
    for (let level = 0; level < 5000; level += 1) {
      block = { type: 'blockquote', content: [block] };
      span = { type: 'span', content: [span] };
    }
    expect(sanitizeRichText(doc(p(text('Top'), span), block), all)).toEqual(doc(p(text('Top'))));
  });

  it('keeps every line of a list nested 20 levels deep', () => {
    let item: JSONContent = { type: 'listItem', content: [p(text('20'))] };
    for (let level = 19; level >= 1; level -= 1) {
      const inside: JSONContent = { type: 'bulletList', content: [item] };
      item = { type: 'listItem', content: [p(text(String(level))), inside] };
    }
    const value = doc({ type: 'bulletList', content: [item] });
    const lines = sanitizeRichText(value, all).content?.map((line) => line.content?.[0]?.text);
    expect(lines).toEqual(Array.from({ length: 20 }, (_, index) => String(index + 1)));
  });

  it('splits stored line breaks into hard breaks and joins text with the same marks', () => {
    expect(sanitizeRichText(doc(p(text('a\nb'), text('c'))), all)).toEqual(
      doc(p(text('a'), { type: 'hardBreak' }, text('bc'))),
    );
  });
});

describe('single-line paste', () => {
  const schema = getSchema(richTextExtensions({ marks: RICH_TEXT_MARKS, singleLine: true }));

  it('joins pasted lines with spaces', () => {
    expect(toSingleLine('one\r\n  two\n\nthree ')).toBe('one two three ');
  });

  it('leaves spaces without a line break as they are, also long runs of them', () => {
    expect(toSingleLine('a \t\u00a0b \n\t c')).toBe('a \t\u00a0b c');
    const spaces = ' '.repeat(40_000);
    expect(toSingleLine(`a${spaces}b`)).toBe(`a${spaces}b`);
  });

  it('flattens pasted blocks into one line, keeping marks', () => {
    const bold = schema.marks.bold?.create();
    const slice = new Slice(
      Fragment.from([
        schema.node('paragraph', null, [schema.text('First', bold ? [bold] : [])]),
        schema.node('paragraph', null, [schema.text('second')]),
      ]),
      0,
      0,
    );
    const flat = flattenSlice(slice, schema);
    expect(flat.content.childCount).toBe(1);
    expect(flat.content.firstChild?.textContent).toBe('First second');
    expect(flat.content.firstChild?.firstChild?.marks.map((m) => m.type.name)).toEqual(['bold']);
  });

  it('has no hard breaks, and the document holds one paragraph', () => {
    expect(schema.nodes.hardBreak).toBeUndefined();
    expect(schema.topNodeType.spec.content).toBe('paragraph');
  });
});

describe('richTextExtensions', () => {
  it('has only the marks you allow', () => {
    const schema = getSchema(richTextExtensions({ marks: ['bold', 'link'], singleLine: false }));
    expect(Object.keys(schema.marks).sort()).toEqual(['bold', 'link']);
    expect(Object.keys(schema.nodes).sort()).toEqual(['doc', 'hardBreak', 'paragraph', 'text']);
  });
});

// The server loads `@carehub/editor/schema`, so what it gets from there needs no React or styles.
// (Vite needs the glob options written out.)
const valueFile = import.meta.glob('../src/richtext-value.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('@carehub/editor/schema', () => {
  it('has sanitizeRichText, from a file that imports no React or styles', () => {
    expect(sanitizeFromSchema).toBe(sanitizeRichText);
    const source = Object.values(valueFile)[0] ?? '';
    const imports = [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)];
    expect(imports.map((match) => match[1])).toEqual(['@tiptap/core', './links']);
  });
});
