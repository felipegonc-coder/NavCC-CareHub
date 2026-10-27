// Reading Evernote's .enex export (Import and export spec, section 3.2; IE-05): each note's
// title, dates, tags, author and web address, its content (ENML, Evernote's XHTML) and its
// attachments. Read piece by piece, a note at a time, so a big notebook is never one string.
import { createXmlReader, XmlError, type XmlEvent, type XmlReader } from './xml';

export interface EnexResource {
  /** Base64, as in the file. */
  data: string;
  mime: string;
  fileName: string | null;
  sourceUrl: string | null;
}

export interface EnexNote {
  title: string;
  /** ISO 8601 (UTC), or null. */
  created: string | null;
  updated: string | null;
  tags: string[];
  author: string | null;
  sourceUrl: string | null;
  /** The note's ENML, as in the file. */
  content: string;
  resources: EnexResource[];
}

/** Thrown when the file isn't an Evernote export: "Pick a .enex file from Evernote." */
export class NotEnexError extends Error {
  constructor() {
    super('Pick a .enex file from Evernote.');
  }
}

/** Evernote's dates ("20261027T143000Z") in ISO 8601, or null. */
export function enexDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** The fields it keeps, by the path of element names under `<note>`. */
const NOTE_FIELDS = new Set([
  'title',
  'created',
  'updated',
  'tag',
  'content',
  'note-attributes/author',
  'note-attributes/source-url',
]);
const RESOURCE_FIELDS = new Set([
  'data',
  'mime',
  'resource-attributes/file-name',
  'resource-attributes/source-url',
]);

/**
 * Reads an .enex file pushed in pieces and calls `onNote` with each note as soon as it's read.
 * Throws NotEnexError when the file doesn't start with `<en-export>`, and XmlError when it's
 * damaged.
 */
export function createEnexReader(onNote: (note: EnexNote) => void): XmlReader {
  const path: string[] = [];
  let started = false;
  let note: { fields: Map<string, string[]>; resources: EnexResource[] } | null = null;
  let resource: Map<string, string[]> | null = null;
  // Where the text being collected goes; null when it isn't kept.
  let collect: string[] | null = null;

  const first = (fields: Map<string, string[]>, key: string) =>
    (fields.get(key) ?? []).find((value) => value.trim())?.trim() ?? null;

  const onEvent = (event: XmlEvent) => {
    if (event.type === 'text') {
      collect?.push(event.text);
      return;
    }
    if (event.type === 'open') {
      if (!started) {
        if (event.name !== 'en-export') throw new NotEnexError();
        started = true;
        path.push(event.name);
        return;
      }
      path.push(event.name);
      const depth = path.length;
      if (depth === 2 && event.name === 'note') {
        note = { fields: new Map(), resources: [] };
      } else if (note && depth === 3 && event.name === 'resource') {
        resource = new Map();
      } else if (note && depth >= 3 && !collect) {
        const inner = path.slice(resource ? 3 : 2).join('/');
        const fields = resource ?? note.fields;
        if ((resource ? RESOURCE_FIELDS : NOTE_FIELDS).has(inner)) {
          collect = [];
          fields.set(inner, [...(fields.get(inner) ?? []), '']);
        }
      }
      return;
    }
    // A close tag: it must close the element that's open.
    if (path[path.length - 1] !== event.name) {
      throw new XmlError(`This file is damaged: </${event.name}> closes <${path.at(-1) ?? ''}>.`);
    }
    const depth = path.length;
    if (collect && note) {
      const inner = path.slice(resource ? 3 : 2).join('/');
      const fields = resource ?? note.fields;
      const values = fields.get(inner);
      if (values && (resource ? RESOURCE_FIELDS : NOTE_FIELDS).has(inner)) {
        values[values.length - 1] = collect.join('');
        collect = null;
      }
    }
    if (resource && note && depth === 3 && event.name === 'resource') {
      note.resources.push({
        data: (resource.get('data') ?? []).join('').replace(/\s+/g, ''),
        mime: first(resource, 'mime') ?? 'application/octet-stream',
        fileName: first(resource, 'resource-attributes/file-name'),
        sourceUrl: first(resource, 'resource-attributes/source-url'),
      });
      resource = null;
    } else if (note && depth === 2 && event.name === 'note') {
      const { fields, resources } = note;
      onNote({
        title: first(fields, 'title') ?? 'Untitled',
        created: enexDate(first(fields, 'created') ?? ''),
        updated: enexDate(first(fields, 'updated') ?? ''),
        tags: [...new Set((fields.get('tag') ?? []).map((tag) => tag.trim()).filter(Boolean))],
        author: first(fields, 'note-attributes/author'),
        sourceUrl: first(fields, 'note-attributes/source-url'),
        content: (fields.get('content') ?? [''])[0] ?? '',
        resources,
      });
      note = null;
    }
    path.pop();
  };

  const xml = createXmlReader(onEvent);
  return {
    push: (chunk) => xml.push(chunk),
    end() {
      xml.end();
      if (!started) throw new NotEnexError();
      if (path.length > 0) throw new XmlError('This file ends before its last note does.');
    },
  };
}

/** The notes of a whole .enex file. */
export function readEnex(text: string): EnexNote[] {
  const notes: EnexNote[] = [];
  const reader = createEnexReader((note) => notes.push(note));
  reader.push(text);
  reader.end();
  return notes;
}
