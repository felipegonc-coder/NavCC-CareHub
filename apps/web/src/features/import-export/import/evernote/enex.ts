// Reading Evernote's .enex export (Import and export spec, section 3.2; IE-05) with #109's XML
// tokenizer: each note's title, dates, tags, content (ENML, Evernote's XHTML, read later with the
// browser's DOMParser) and attachments, matched to the content by the MD5 of their bytes.
import { XmlError, xmlTokens } from '@carehub/databases/xlsx';
import { md5Hex } from '@carehub/extras/import-export/import/evernote/md5';
import { IMPORT_LIMITS, ImportFileError } from '@carehub/extras/import-export/import/plan';

export const NOT_ENEX = "the file isn't an Evernote export";
const TOO_MANY_NOTES = 'imports can have up to 10,000 pages';
const TOO_MANY_FILES = 'imports can have up to 50,000 files';
/** Databases' longest option name, for tags. */
export const TAG_CHARS = 100;
/** Most tags a note keeps (a multi-select's limit). */
export const TAGS_PER_NOTE = 100;

export interface EnexResource {
  /** The MD5 of `bytes`, as `<en-media hash>` names it. */
  hash: string;
  mime: string;
  fileName: string | null;
  bytes: Uint8Array;
}

export interface EnexNote {
  title: string;
  /** ISO 8601 (UTC), or null. */
  created: string | null;
  updated: string | null;
  tags: string[];
  /** The note's ENML. */
  enml: string;
  resources: EnexResource[];
}

/** Evernote's dates ("20261027T143000Z") in ISO 8601, or null. */
export function enexDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  const time = Date.parse(iso);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== iso.slice(0, 10)
    ? null
    : iso;
}

/** A DOCTYPE that only names a DTD elsewhere (SYSTEM or PUBLIC), with no declarations in it. */
const EXTERNAL_DOCTYPE =
  /<!DOCTYPE\s+[A-Za-z_:][\w.:-]*\s+(?:SYSTEM|PUBLIC\s+(?:"[^"]*"|'[^']*'))\s+(?:"[^"]*"|'[^']*')\s*>/y;

/**
 * The export without its `<!DOCTYPE en-export SYSTEM "...">` line, which the tokenizer refuses.
 * Only one DOCTYPE is cut, right before the root element, and only one that names a DTD without
 * declaring anything (no `[...]`, where entities are defined). Any other stays, so the tokenizer
 * refuses the file. The DTD is never read.
 */
export function withoutDoctype(text: string): string {
  const start = /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?/.exec(text)?.[0].length ?? 0;
  EXTERNAL_DOCTYPE.lastIndex = start;
  const doctype = EXTERNAL_DOCTYPE.exec(text);
  return doctype ? text.slice(0, start) + text.slice(start + doctype[0].length) : text;
}

/** Base64 (with line breaks, as Evernote writes it) as bytes, or null when it isn't base64. */
function fromBase64(data: string): Uint8Array | null {
  try {
    const binary = atob(data.replace(/\s+/g, ''));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Where the reader is inside a note: the element names from `<note>` down. */
type Field = 'title' | 'created' | 'updated' | 'tag' | 'content' | 'data' | 'mime' | 'file-name';
const NOTE_FIELDS: Partial<Record<string, Field>> = {
  'note/title': 'title',
  'note/created': 'created',
  'note/updated': 'updated',
  'note/tag': 'tag',
  'note/content': 'content',
  'note/resource/data': 'data',
  'note/resource/mime': 'mime',
  'note/resource/resource-attributes/file-name': 'file-name',
};

interface Draft {
  title: string;
  created: string;
  updated: string;
  tags: string[];
  enml: string;
  resources: { data: string; mime: string; fileName: string }[];
}

/**
 * The notes of an .enex file, in file order. Throws ImportFileError when it isn't one (or has a
 * DTD of its own), and as soon as it has more notes or attachments than an import can hold.
 */
export function readEnex(text: string): EnexNote[] {
  const notes: EnexNote[] = [];
  let files = 0;
  const path: string[] = [];
  let note: Draft | null = null;
  let field: Field | undefined;
  let value = '';
  let root = false;
  /** `</en-export>` was read: a file cut short (a download that stopped) is refused. */
  let ended = false;

  const finish = (draft: Draft) => {
    const resources: EnexResource[] = [];
    for (const resource of draft.resources) {
      const bytes = fromBase64(resource.data);
      if (!bytes || bytes.length === 0) continue;
      resources.push({
        hash: md5Hex(bytes),
        mime: resource.mime.trim().toLowerCase() || 'application/octet-stream',
        fileName: resource.fileName.trim() || null,
        bytes,
      });
    }
    notes.push({
      title: draft.title.trim(),
      created: enexDate(draft.created),
      updated: enexDate(draft.updated),
      tags: draft.tags,
      enml: draft.enml,
      resources,
    });
  };

  try {
    for (const token of xmlTokens(withoutDoctype(text))) {
      if (token.kind === 'text') {
        if (field) value += token.text;
        else if (!root && token.text.trim()) throw new ImportFileError(NOT_ENEX);
        continue;
      }
      if (token.kind === 'open') {
        if (!root) {
          if (token.name !== 'en-export') throw new ImportFileError(NOT_ENEX);
          root = true;
          ended = token.selfClosing;
          if (ended) break;
          continue;
        }
        if (path.length === 0 && token.name === 'note') {
          if (notes.length >= IMPORT_LIMITS.pages - 1) throw new ImportFileError(TOO_MANY_NOTES);
          note = { title: '', created: '', updated: '', tags: [], enml: '', resources: [] };
        }
        if (note && path.length === 1 && token.name === 'resource') {
          if (++files > IMPORT_LIMITS.files) throw new ImportFileError(TOO_MANY_FILES);
          note.resources.push({ data: '', mime: '', fileName: '' });
        }
        if (token.selfClosing) continue;
        path.push(token.name);
        field = note ? NOTE_FIELDS[path.join('/')] : undefined;
        value = '';
        continue;
      }
      // A closing tag: `</en-export>`, or the end of a field, whose text is kept.
      if (path.length === 0) {
        ended = true;
        break;
      }
      if (note && field) {
        const resource = note.resources.at(-1);
        if (field === 'title') note.title = value;
        else if (field === 'created') note.created = value;
        else if (field === 'updated') note.updated = value;
        else if (field === 'content') note.enml = value;
        else if (field === 'tag') {
          const tag = value.trim();
          if (tag && note.tags.length < TAGS_PER_NOTE && !note.tags.includes(tag))
            note.tags.push(tag);
        } else if (resource && field === 'data') resource.data = value;
        else if (resource && field === 'mime') resource.mime = value;
        else if (resource && field === 'file-name') resource.fileName = value;
      }
      path.pop();
      field = undefined;
      value = '';
      if (note && path.length === 0) {
        finish(note);
        note = null;
      }
    }
  } catch (error) {
    if (error instanceof XmlError) throw new ImportFileError(NOT_ENEX);
    throw error;
  }
  if (!ended) throw new ImportFileError(NOT_ENEX);
  return notes;
}
