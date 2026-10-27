// The text layer of iCalendar (RFC 5545 section 3.1): folded lines, content lines with
// parameters (RFC 6868 caret encoding), components, and TEXT escaping.

export interface ContentLine {
  name: string; // upper case
  params: Map<string, string[]>; // names upper case, values as written
  value: string;
  line: number; // 1-based line where it starts, for warnings
}

export interface Component {
  name: string; // upper case, such as 'VEVENT'
  props: ContentLine[];
  children: Component[];
}

const MAX_DEPTH = 8;

/** Removes folds (a line break followed by one space or tab) before UTF-8 decoding. */
export function unfoldBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  let size = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]!;
    const crlf = byte === 13 && bytes[i + 1] === 10;
    if (byte === 10 || crlf) {
      const next = bytes[i + (crlf ? 2 : 1)];
      if (next === 32 || next === 9) {
        i += crlf ? 2 : 1;
        continue;
      }
    }
    out[size++] = byte;
  }
  return out.subarray(0, size);
}

/** Splits text into unfolded logical lines. Accepts CRLF, LF or CR line breaks. */
export function* logicalLines(text: string): Generator<{ text: string; line: number }> {
  const physical = text.split(/\r\n|\n|\r/);
  let current: { text: string; line: number } | undefined;
  for (let i = 0; i < physical.length; i++) {
    const raw = physical[i]!;
    if (current && (raw.startsWith(' ') || raw.startsWith('\t'))) {
      current.text += raw.slice(1);
      continue;
    }
    if (current && current.text !== '') yield current;
    current = { text: raw, line: i + 1 };
  }
  if (current && current.text !== '') yield current;
}

/** Reads `NAME;PARAM=a,"b;c":value`. Returns undefined for a malformed line. */
export function parseContentLine(text: string, line: number): ContentLine | undefined {
  const n = text.length;
  let i = 0;
  while (i < n && text[i] !== ';' && text[i] !== ':') i++;
  const name = text.slice(0, i).trim().toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(name)) return undefined;
  const params = new Map<string, string[]>();
  while (text[i] === ';') {
    const start = ++i;
    while (i < n && text[i] !== '=' && text[i] !== ';' && text[i] !== ':') i++;
    const paramName = text.slice(start, i).trim().toUpperCase();
    const values: string[] = [];
    while (text[i] === '=' || text[i] === ',') {
      i++;
      if (text[i] === '"') {
        const end = text.indexOf('"', i + 1);
        if (end < 0) return undefined;
        values.push(decodeParamValue(text.slice(i + 1, end)));
        i = end + 1;
        while (i < n && text[i] !== ',' && text[i] !== ';' && text[i] !== ':') i++;
      } else {
        const valueStart = i;
        while (i < n && text[i] !== ',' && text[i] !== ';' && text[i] !== ':') i++;
        values.push(decodeParamValue(text.slice(valueStart, i)));
      }
    }
    if (paramName) params.set(paramName, [...(params.get(paramName) ?? []), ...values]);
  }
  if (text[i] !== ':') return undefined;
  return { name, params, value: text.slice(i + 1), line };
}

/** RFC 6868: ^n is a line break, ^' a double quote and ^^ a caret. */
function decodeParamValue(value: string): string {
  return value.replace(/\^([n'^])/g, (_, ch: string) =>
    ch === 'n' ? '\n' : ch === "'" ? '"' : '^',
  );
}

/** Builds the component tree. Stray or missing END lines are tolerated. */
export function readComponents(lines: Iterable<ContentLine>): Component[] {
  const roots: Component[] = [];
  const stack: Component[] = [];
  for (const line of lines) {
    if (line.name === 'BEGIN' || line.name === 'END') {
      const name = line.value.trim().toUpperCase();
      // A component never contains its own kind, so BEGIN:VEVENT also ends an open VEVENT.
      const open = stack.findLastIndex((c) => c.name === name);
      if (open >= 0) stack.length = open;
      if (line.name === 'BEGIN') {
        const component: Component = { name, props: [], children: [] };
        const parent = stack.at(-1);
        if (stack.length < MAX_DEPTH) (parent ? parent.children : roots).push(component);
        stack.push(component);
      }
    } else {
      stack.at(-1)?.props.push(line);
    }
  }
  return roots;
}

/** Undoes TEXT escaping: \\ \; \, and \n (or \N). Unknown escapes keep the character. */
export function unescapeText(value: string): string {
  return value.replace(/\\(.)/gs, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

/** Escapes a TEXT value. Line breaks become \n; other control characters are dropped. */
export function escapeText(value: string): string {
  return stripControls(value.replace(/\r\n?/g, '\n')).replace(/[\\;,\n]/g, (ch) =>
    ch === '\n' ? '\\n' : `\\${ch}`,
  );
}

/** Drops control characters except tab (and line feed when `keepNewlines`). */
export function stripControls(value: string, keepNewlines = true): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x20 && code !== 0x7f) || code === 9 || (keepNewlines && code === 10)) out += ch;
  }
  return out;
}

/** A parameter value, quoted when needed, with RFC 6868 caret encoding. */
export function formatParamValue(value: string): string {
  const encoded = stripControls(value)
    .replace(/\^/g, '^^')
    .replace(/\n/g, '^n')
    .replace(/"/g, "^'");
  return /[;:,]/.test(encoded) ? `"${encoded}"` : encoded;
}

/** Folds a content line at 75 octets without splitting a UTF-8 character. */
export function foldLine(line: string): string {
  let out = '';
  let size = 0;
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0;
    const bytes = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (size + bytes > 75) {
      out += '\r\n ';
      size = 1;
    }
    out += ch;
    size += bytes;
  }
  return out;
}
