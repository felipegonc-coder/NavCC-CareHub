// A small streaming XML reader for imports (Evernote's .enex files and the notes inside them):
// it turns text into open, close and text events, piece by piece, so a big file never has to be
// one string. It reads tags, attributes, text, CDATA and character references; it skips
// comments, processing instructions and the DOCTYPE, and never reads a DTD, so a file can't
// define entities of its own. It doesn't check that tags match: the reader of the events does.

export type XmlEvent =
  | { type: 'open'; name: string; attrs: Record<string, string>; empty: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string };

export class XmlError extends Error {}

export interface XmlOptions {
  /** Named entities besides XML's five, such as HTML's `&nbsp;` in Evernote notes. */
  entities?: Readonly<Record<string, string>>;
  /** The longest comment or CDATA section it holds, in characters (64 Mi). */
  maxToken?: number;
}

export interface XmlReader {
  /** Reads the next piece of the text; events for what's complete go out at once. */
  push(chunk: string): void;
  /** The text has ended: throws XmlError if it stopped inside a tag. */
  end(): void;
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

const MAX_TOKEN = 64 * 1024 * 1024;
/** The longest tag or DOCTYPE, which are read again from their start as more text comes. */
const MAX_TAG = 1024 * 1024;
const NAME = /^[^\s/>"'=]+/;
const ATTRIBUTE = /([^\s/>"'=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
const REFERENCE = /&(#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]*);/gi;

/** Text with its character and entity references read; unknown references stay as they are. */
export function decodeEntities(
  text: string,
  entities: Readonly<Record<string, string>> = XML_ENTITIES,
): string {
  if (!text.includes('&')) return text;
  return text.replace(REFERENCE, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code =
        name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      const valid =
        code === 0x9 ||
        code === 0xa ||
        code === 0xd ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff);
      return valid ? String.fromCodePoint(code) : whole;
    }
    return Object.hasOwn(entities, name) ? (entities[name] as string) : whole;
  });
}

/** Where `<!DOCTYPE ...>` ends (after its `>`), skipping an internal subset in brackets. */
function doctypeEnd(text: string, from: number): number {
  let depth = 0;
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === '>' && depth === 0) return i + 1;
  }
  return -1;
}

/** Where a tag ends (after its `>`); a `>` inside a quoted value doesn't end it. */
function tagEnd(text: string, from: number): number {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i + 1;
  }
  return -1;
}

export function createXmlReader(
  onEvent: (event: XmlEvent) => void,
  options: XmlOptions = {},
): XmlReader {
  const entities = options.entities ? { ...options.entities, ...XML_ENTITIES } : XML_ENTITIES;
  const maxToken = options.maxToken ?? MAX_TOKEN;
  let buffer = '';
  let ended = false;
  // Where to look on for the end of a comment, CDATA section or instruction cut by a chunk, so a
  // long one isn't searched from its start again with each chunk.
  let resume = 0;

  const text = (raw: string) => {
    if (raw) onEvent({ type: 'text', text: decodeEntities(raw, entities) });
  };

  const tag = (raw: string) => {
    if (raw.startsWith('</')) {
      const name = NAME.exec(raw.slice(2).trimStart())?.[0];
      if (!name) throw new XmlError('This file has a closing tag without a name.');
      onEvent({ type: 'close', name });
      return;
    }
    const body = raw.slice(1, -1);
    const name = NAME.exec(body)?.[0];
    if (!name) throw new XmlError('This file has a tag without a name.');
    const empty = body.endsWith('/');
    const attrs: Record<string, string> = {};
    const rest = body.slice(name.length, empty ? -1 : undefined);
    for (const match of rest.matchAll(ATTRIBUTE)) {
      const [, key, double, single, bare] = match;
      if (key && !Object.hasOwn(attrs, key)) {
        attrs[key] = decodeEntities(double ?? single ?? bare ?? '', entities);
      }
    }
    onEvent({ type: 'open', name, attrs, empty });
    if (empty) onEvent({ type: 'close', name });
  };

  /** Reads what's complete in the buffer; returns how much it used. */
  const read = (final: boolean): number => {
    let at = 0;
    while (at < buffer.length) {
      const lt = buffer.indexOf('<', at);
      if (lt !== at) {
        // Text up to the next tag. Without one, a reference cut in two waits for the rest.
        let stop = lt === -1 ? buffer.length : lt;
        if (lt === -1 && !final) {
          const amp = buffer.lastIndexOf('&');
          if (amp >= at && amp > buffer.length - 12 && !buffer.includes(';', amp)) stop = amp;
        }
        text(buffer.slice(at, stop));
        at = stop;
        if (lt === -1) return at;
        continue;
      }
      let end: number;
      let skip = false;
      let cdata = false;
      let limit = maxToken;
      const until = (open: string, close: string) => {
        const from = Math.max(at + open.length, at === 0 ? resume : 0);
        const found = buffer.indexOf(close, from);
        if (found === -1) resume = Math.max(from, buffer.length - close.length + 1);
        return found === -1 ? -1 : found + close.length;
      };
      if (buffer.length - at < 9 && !final && '<![CDATA['.startsWith(buffer.slice(at))) {
        end = -1;
      } else if (buffer.startsWith('<!--', at)) {
        end = until('<!--', '-->');
        skip = true;
      } else if (buffer.startsWith('<![CDATA[', at)) {
        end = until('<![CDATA[', ']]>');
        cdata = true;
      } else if (buffer.startsWith('<?', at)) {
        end = until('<?', '?>');
        skip = true;
      } else if (buffer.startsWith('<!', at)) {
        end = doctypeEnd(buffer, at + 2);
        skip = true;
        limit = MAX_TAG;
      } else {
        end = tagEnd(buffer, at + 1);
        limit = MAX_TAG;
      }
      if (end === -1) {
        if (final) throw new XmlError('This file ends in the middle of a tag.');
        if (buffer.length - at > limit) throw new XmlError('This file has a tag that never ends.');
        // The cut token starts the buffer from now on.
        resume = Math.max(0, resume - at);
        return at;
      }
      resume = 0;
      if (end - at > limit) throw new XmlError('This file has a tag that never ends.');
      if (cdata) {
        const content = buffer.slice(at + 9, end - 3);
        if (content) onEvent({ type: 'text', text: content });
      } else if (!skip) {
        tag(buffer.slice(at, end));
      }
      at = end;
    }
    return at;
  };

  return {
    push(chunk) {
      if (ended) throw new XmlError('This file was already read to the end.');
      buffer += chunk;
      buffer = buffer.slice(read(false));
    },
    end() {
      if (ended) return;
      ended = true;
      read(true);
      buffer = '';
    },
  };
}

/** The events of a whole document. */
export function xmlEvents(text: string, options?: XmlOptions): XmlEvent[] {
  const events: XmlEvent[] = [];
  const reader = createXmlReader((event) => events.push(event), options);
  reader.push(text);
  reader.end();
  return events;
}
