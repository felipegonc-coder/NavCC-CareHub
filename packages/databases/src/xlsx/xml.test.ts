import { describe, expect, it } from 'vitest';
import { decodeXmlText, XmlError, xmlTokens } from './xml';

/** Tokens as short strings: "<row r=2>", "<c/>", "</row>", or the text itself. */
const show = (xml: string): string[] =>
  [...xmlTokens(xml)].map((t) => {
    if (t.kind === 'text') return t.text;
    if (t.kind === 'close') return `</${t.name}>`;
    const attrs = [...t.attrs].map(([k, v]) => ` ${k}=${v}`).join('');
    return `<${t.name}${attrs}${t.selfClosing ? '/' : ''}>`;
  });

describe('xmlTokens', () => {
  it('gives elements without their prefix, attributes with theirs, and text', () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
      '<x:sst xmlns:x="urn:main" count=\'2\'><x:si><x:t xml:space="preserve">Avery Lin</x:t></x:si><x:si/></x:sst>';
    expect(show(xml)).toEqual([
      '\r\n',
      '<sst xmlns:x=urn:main count=2>',
      '<si>',
      '<t xml:space=preserve>',
      'Avery Lin',
      '</t>',
      '</si>',
      '<si/>',
      '</sst>',
    ]);
  });

  it('reads attributes with spaces, either quote, and > or / inside the value', () => {
    expect(show('<numFmt  numFmtId = "164"\n formatCode=\'[&gt;=100]0;"a/b"\' />')).toEqual([
      '<numFmt numFmtId=164 formatCode=[>=100]0;"a/b"/>',
    ]);
    expect([...xmlTokens('<c r="A1" s="2"/>')][0]).toEqual({
      kind: 'open',
      name: 'c',
      attrs: new Map([
        ['r', 'A1'],
        ['s', '2'],
      ]),
      selfClosing: true,
    });
    expect(show('<v >7</v >')).toEqual(['<v>', '7', '</v>']);
  });

  it('decodes entities in text and attribute values', () => {
    expect(
      show('<t a="&quot;Blue Pine&quot; &amp; Co">Lin &amp; Park &lt;3 &#38;&#x26;</t>'),
    ).toEqual(['<t a="Blue Pine" & Co>', 'Lin & Park <3 &&', '</t>']);
  });

  it('skips comments and processing instructions and gives CDATA as it is', () => {
    expect(show('<a><!-- a <b> comment --><?mso-application progid="Excel.Sheet"?>x</a>')).toEqual([
      '<a>',
      'x',
      '</a>',
    ]);
    expect(show('<t><![CDATA[Jordan &amp; <Park>]]></t>')).toEqual([
      '<t>',
      'Jordan &amp; <Park>',
      '</t>',
    ]);
  });

  it('gives text before the first element and after the last one', () => {
    expect(show('lead<a/>tail')).toEqual(['lead', '<a/>', 'tail']);
    expect(show('')).toEqual([]);
  });

  it.each([
    ['<!DOCTYPE x [<!ENTITY e "boom">]><x>&e;</x>'],
    ['<x><!ENTITY e SYSTEM "file:///etc/passwd"></x>'],
    ['<!doctype x><x/>'],
  ])('refuses DOCTYPE and ENTITY declarations: %s', (xml: string) => {
    expect(() => [...xmlTokens(xml)]).toThrow(XmlError);
  });

  it('says where the markup went wrong', () => {
    expect(() => [...xmlTokens('<a><!DOCTYPE a></a>')]).toThrow(
      'DOCTYPE and ENTITY declarations are not allowed at character 3.',
    );
  });

  it.each([
    ['<a><!-- never closed</a>'],
    ['<a><![CDATA[never closed</a>'],
    ['<?xml version="1.0"'],
    ['<a b="1></a>'],
    ['<a b=1>'],
    ['<a b>'],
    ['<a'],
    ['< a>'],
    ['<>'],
    ['</>'],
    ['<a></a'],
    ['<a>&nbsp;</a>'],
    ['<a>&amp</a>'],
  ])('refuses markup that is not well formed: %s', (xml: string) => {
    expect(() => [...xmlTokens(xml)]).toThrow(XmlError);
  });
});

describe('decodeXmlText', () => {
  it('replaces the five named entities', () => {
    expect(decodeXmlText('&lt;b&gt; &amp; &quot;x&quot; &apos;y&apos;')).toBe('<b> & "x" \'y\'');
  });

  it('replaces decimal and hex character references, including astral ones', () => {
    expect(decodeXmlText('&#65;&#x42;&#X43;&#x1F600;&#128512;&#9;')).toBe(
      'ABC\u{1F600}\u{1F600}\t',
    );
  });

  it('leaves text without references alone', () => {
    expect(decodeXmlText('Blue Pine Plumbing')).toBe('Blue Pine Plumbing');
  });

  it.each([
    ['&#0;'],
    ['&#x1;'],
    ['&#xD800;'],
    ['&#xFFFE;'],
    ['&#x110000;'],
    ['&#;'],
    ['&#x;'],
    ['&#12a;'],
    ['&nbsp;'],
    ['&AMP;'],
    ['a & b'],
  ])('refuses %s', (s: string) => {
    expect(() => decodeXmlText(s)).toThrow(XmlError);
  });
});
