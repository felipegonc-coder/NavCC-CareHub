/**
 * A small XML tokenizer for the parts of an .xlsx file (workbook, sheets, shared strings, styles):
 * elements, attributes and text, with the five predefined entities and character references
 * decoded. DOCTYPE and ENTITY declarations are refused, so nothing can define or expand entities.
 */

/** An element name without its namespace prefix ("x:row" is "row"); attribute names keep theirs. */
export type XmlToken =
  | { kind: 'open'; name: string; attrs: Map<string, string>; selfClosing: boolean }
  | { kind: 'close'; name: string }
  | { kind: 'text'; text: string };

/** Markup that isn't well formed, or a DOCTYPE or ENTITY declaration. */
export class XmlError extends Error {
  override name = 'XmlError';
}

const NAMED = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

/** Whether XML allows this character (tab, line breaks, and everything from space up but surrogates, FFFE and FFFF). */
const isXmlChar = (cp: number): boolean =>
  cp === 0x9 ||
  cp === 0xa ||
  cp === 0xd ||
  (cp >= 0x20 && cp <= 0xd7ff) ||
  (cp >= 0xe000 && cp <= 0xfffd) ||
  (cp >= 0x10000 && cp <= 0x10ffff);

/** Text or an attribute value with &amp; &lt; &gt; &quot; &apos;, &#38; and &#x26; replaced. */
export function decodeXmlText(s: string): string {
  let amp = s.indexOf('&');
  if (amp < 0) return s;
  let out = '';
  let from = 0;
  while (amp >= 0) {
    const semi = s.indexOf(';', amp);
    if (semi < 0) throw new XmlError('An entity reference has no closing ";".');
    const ref = s.slice(amp + 1, semi);
    let char = NAMED.get(ref);
    if (char === undefined) {
      const r = /^#(?:x([\da-f]{1,6})|(\d{1,7}))$/i.exec(ref);
      const cp = r ? (r[1] ? parseInt(r[1], 16) : Number(r[2])) : -1;
      if (!isXmlChar(cp)) throw new XmlError(`Unknown entity "&${ref.slice(0, 20)};".`);
      char = String.fromCodePoint(cp);
    }
    out += s.slice(from, amp) + char;
    from = semi + 1;
    amp = s.indexOf('&', from);
  }
  return out + s.slice(from);
}

const isSpace = (c: number): boolean => c === 0x20 || c === 0x9 || c === 0xa || c === 0xd;
/** Characters that end a name: space, "=", "/", ">", "<" and quotes. */
const endsName = (c: number): boolean =>
  isSpace(c) || c === 0x3d || c === 0x2f || c === 0x3e || c === 0x3c || c === 0x22 || c === 0x27;
const localName = (name: string): string => name.slice(name.indexOf(':') + 1);

/**
 * The tokens of an XML document in order. The XML declaration, processing instructions and
 * comments are skipped; CDATA sections come out as text. Throws XmlError for a DOCTYPE (or any
 * other "<!" declaration), unknown entities and unclosed markup. Nesting isn't checked.
 */
export function* xmlTokens(xml: string): Generator<XmlToken, void, undefined> {
  const n = xml.length;
  let i = 0;
  function fail(what: string): never {
    throw new XmlError(`${what} at character ${i}.`);
  }
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt !== i) {
      yield { kind: 'text', text: decodeXmlText(xml.slice(i, lt < 0 ? n : lt)) };
      if (lt < 0) return;
      i = lt;
    }
    const next = xml.charCodeAt(i + 1);
    if (next === 0x21 /* ! */) {
      if (xml.startsWith('<!--', i)) {
        const e = xml.indexOf('-->', i + 4);
        if (e < 0) fail('Unclosed comment');
        i = e + 3;
      } else if (xml.startsWith('<![CDATA[', i)) {
        const e = xml.indexOf(']]>', i + 9);
        if (e < 0) fail('Unclosed CDATA section');
        yield { kind: 'text', text: xml.slice(i + 9, e) };
        i = e + 3;
      } else {
        fail('DOCTYPE and ENTITY declarations are not allowed');
      }
      continue;
    }
    if (next === 0x3f /* ? */) {
      const e = xml.indexOf('?>', i + 2);
      if (e < 0) fail('Unclosed processing instruction');
      i = e + 2;
      continue;
    }
    if (next === 0x2f /* / */) {
      const e = xml.indexOf('>', i + 2);
      const name = e < 0 ? '' : xml.slice(i + 2, e).trim();
      if (!name) fail('Bad closing tag');
      yield { kind: 'close', name: localName(name) };
      i = e + 1;
      continue;
    }
    let j = i + 1;
    while (j < n && !endsName(xml.charCodeAt(j))) j++;
    if (j === i + 1) fail('Bad tag');
    const name = localName(xml.slice(i + 1, j));
    const attrs = new Map<string, string>();
    let selfClosing = false;
    for (;;) {
      while (j < n && isSpace(xml.charCodeAt(j))) j++;
      const c = xml.charCodeAt(j);
      if (c === 0x3e /* > */) {
        j++;
        break;
      }
      if (c === 0x2f && xml.charCodeAt(j + 1) === 0x3e) {
        selfClosing = true;
        j += 2;
        break;
      }
      const start = j;
      while (j < n && !endsName(xml.charCodeAt(j))) j++;
      const attr = xml.slice(start, j);
      while (j < n && isSpace(xml.charCodeAt(j))) j++;
      if (!attr || xml.charCodeAt(j) !== 0x3d /* = */) fail('Bad attribute');
      j++;
      while (j < n && isSpace(xml.charCodeAt(j))) j++;
      const quote = xml[j];
      const close = quote === '"' || quote === "'" ? xml.indexOf(quote, j + 1) : -1;
      if (close < 0) fail('Bad attribute value');
      attrs.set(attr, decodeXmlText(xml.slice(j + 1, close)));
      j = close + 1;
    }
    yield { kind: 'open', name, attrs, selfClosing };
    i = j;
  }
}
