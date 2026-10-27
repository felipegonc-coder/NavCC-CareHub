// Evernote's .enex export as an import plan (Import and export spec, section 3.2; IE-05), made on
// the Import screen: a page per notebook with each note under it, or "As a database" one database
// with a row per note, its tags as a multi-select and its created and updated dates. Pictures show
// in place, other attachments become files, and checklists become to-dos.
import {
  contentSize,
  IMPORT_LIMITS,
  ImportFileError,
  planLink,
  type ImportPlan,
  type Importer,
  type PlanColumn,
  type PlanContent,
} from '@carehub/extras/import-export/import/plan';
import type { HtmlToContent } from '@carehub/extras/import-export/import/writer/html-reader';
import { fitPage } from '@carehub/extras/import-export/import/writer/fit-page';
import { PlanWriter, shortName } from '@carehub/extras/import-export/import/writer/plan-writer';
import { NOT_ENEX, readEnex, TAG_CHARS, type EnexNote, type EnexResource } from './enex';
import { enmlToHtml, type EnmlAttachment } from './enml';

export interface EvernoteOptions {
  /** "As a database" (the import's `asDatabase` option): a row per note, not a page per note. */
  asDatabase?: boolean;
}

/** One .enex file: Evernote exports a notebook to a file of its own. */
export interface Notebook {
  name: string;
  notes: EnexNote[];
}

const TOO_MANY_PAGES = 'imports can have up to 10,000 pages';
const TOO_MANY_ROWS = 'databases can have up to 20,000 rows';
/** Pictures the editor shows in place; other attachments are links to their files. */
const PICTURES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const ENDINGS: Partial<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'text/plain': 'txt',
};
const WEB_ADDRESS = /^(?:https?:|mailto:|tel:)/i;
const NOTE_LINK = /^evernote:/i;

const counted = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** A file's name without its folders and its .enex or .zip ending. */
export const notebookName = (fileName: string) =>
  (fileName.split('/').at(-1) ?? fileName).replace(/\.(?:enex|zip)$/i, '').trim();

/** Tags as a multi-select cell: its options are listed with commas between them. */
function tagCell(tags: readonly string[], out: PlanWriter, item: string): string {
  const options: string[] = [];
  for (const tag of tags) {
    let name = tag.replace(/\s*,\s*/g, ' ').trim();
    if (name !== tag)
      out.problem(item, 'Renamed', `Options can't have commas, so "${tag}" is "${name}".`);
    name = out.cut(name, TAG_CHARS, item);
    if (name && !options.includes(name)) options.push(name);
  }
  return options.join(', ');
}

/** Builds the plan as it reads each note, and counts what can't come in. */
class NoteWriter {
  readonly out: PlanWriter;
  #missing = 0;
  #encrypted = 0;
  #noteLinks = 0;

  constructor(
    fileName: string,
    private readonly htmlToContent: HtmlToContent,
  ) {
    this.out = new PlanWriter(fileName);
  }

  /** The note's attachments as files of the plan, by the hash its content names them by. */
  #files(note: EnexNote, item: string): Map<string, EnmlAttachment> {
    const attachments = new Map<string, EnmlAttachment>();
    for (const resource of note.resources) {
      if (attachments.has(resource.hash)) continue;
      const key = this.out.key('file');
      const name = this.out.text(this.#fileName(resource), IMPORT_LIMITS.fileNameChars, item);
      this.out.plan.files.push({ key, name, bytes: resource.bytes });
      attachments.set(resource.hash, {
        href: planLink(key),
        name,
        image: PICTURES.has(resource.mime),
      });
    }
    return attachments;
  }

  #fileName(resource: EnexResource): string {
    if (resource.fileName) return resource.fileName;
    const ending = ENDINGS[resource.mime];
    return ending ? `Attachment.${ending}` : 'Attachment';
  }

  /** The note's page content, counted against the import's text. */
  content(note: EnexNote, item: string): PlanContent {
    const attachments = this.#files(note, item);
    const files = new Set(Array.from(attachments.values(), (attachment) => attachment.href));
    const { html, missing, encrypted } = enmlToHtml(note.enml, attachments);
    this.#missing += missing;
    this.#encrypted += encrypted;
    const link = (href: string) => {
      const address = href.trim();
      if (files.has(address) || WEB_ADDRESS.test(address)) return address;
      if (NOTE_LINK.test(address)) this.#noteLinks += 1;
      return null;
    };
    const read = this.htmlToContent(html, { source: this.out.where(item), link });
    this.out.add(read.problems);
    const content = fitPage(read.content, this.out, item);
    this.out.spend(contentSize(content));
    return content;
  }

  title(note: EnexNote, item: string): string {
    return this.out.text(note.title || 'Untitled', IMPORT_LIMITS.titleChars, item);
  }

  /** The plan, with a line for each kind of thing that couldn't come in. */
  done(): ImportPlan {
    if (this.#missing > 0) {
      const why = `${counted(this.#missing, "attachment isn't", "attachments aren't")} in the export.`;
      this.out.problem(null, 'Left out', why);
    }
    if (this.#encrypted > 0) {
      const what = counted(this.#encrypted, 'encrypted section', 'encrypted sections');
      this.out.problem(null, 'Left out', `${what}: encrypted text can only be opened in Evernote.`);
    }
    if (this.#noteLinks > 0) {
      const what = counted(this.#noteLinks, 'link to another note', 'links to other notes');
      this.out.problem(
        null,
        'Kept as text',
        `${what}. The export doesn't say which note a link opens.`,
      );
    }
    return this.out.done();
  }
}

const noteItem = (note: EnexNote) => `Note "${shortName(note.title || 'Untitled')}"`;

/** A note's created and updated dates, for its page or row. */
const noteDates = (note: EnexNote) => ({
  ...(note.created ? { created: note.created } : {}),
  ...(note.updated ? { updated: note.updated } : {}),
});

/** The plan for one or more notebooks read from `fileName`. */
export function evernotePlan(
  notebooks: readonly Notebook[],
  fileName: string,
  htmlToContent: HtmlToContent,
  options: EvernoteOptions = {},
): ImportPlan {
  const notes = notebooks.reduce((sum, notebook) => sum + notebook.notes.length, 0);
  const writer = new NoteWriter(fileName, htmlToContent);
  const { out } = writer;

  if (!options.asDatabase) {
    if (notebooks.length + notes > IMPORT_LIMITS.pages) throw new ImportFileError(TOO_MANY_PAGES);
    for (const notebook of notebooks) {
      const name = notebook.name || 'Evernote';
      const key = out.key('notebook');
      const title = out.text(name, IMPORT_LIMITS.titleChars, `Notebook "${shortName(name)}"`);
      out.plan.pages.push({
        key,
        parent: null,
        title,
        content: { markdown: '' },
        source: fileName,
      });
      for (const note of notebook.notes) {
        const item = noteItem(note);
        const page = { key: out.key('note'), parent: key, title: writer.title(note, item) };
        const content = writer.content(note, item);
        out.plan.pages.push({ ...page, content, source: fileName, ...noteDates(note) });
      }
    }
    return writer.done();
  }

  if (notes > IMPORT_LIMITS.rows) throw new ImportFileError(TOO_MANY_ROWS);
  const many = notebooks.length > 1;
  const columns: PlanColumn[] = [
    { name: 'Name', type: 'text' },
    ...(many ? [{ name: 'Notebook', type: 'select' } as const] : []),
    { name: 'Tags', type: 'multi_select' },
    { name: 'Created', type: 'date' },
    { name: 'Updated', type: 'date' },
  ];
  const rows = notebooks.flatMap((notebook) => {
    const name = out.cut(notebook.name, TAG_CHARS, `Notebook "${shortName(notebook.name)}"`);
    return notebook.notes.map((note) => {
      const item = noteItem(note);
      const values = [tagCell(note.tags, out, item), note.created ?? '', note.updated ?? ''];
      const cells = [writer.title(note, item), ...(many ? [name] : []), ...values];
      out.spend(cells.slice(1).reduce((sum, cell) => sum + cell.length, 0));
      return {
        key: out.key('note'),
        cells,
        content: writer.content(note, item),
        ...noteDates(note),
      };
    });
  });
  for (const column of columns) out.spend(column.name.length);
  const name = (many ? notebookName(fileName) : notebooks[0]?.name) || 'Evernote';
  out.plan.databases.push({
    key: out.key('notes'),
    parent: null,
    title: out.text(name, IMPORT_LIMITS.titleChars, `Notebook "${shortName(name)}"`),
    columns,
    rows,
    source: fileName,
  });
  return writer.done();
}

/**
 * The Evernote importer, with the Import screen's HTML reader. It reads an .enex file, or a zip
 * of them (a notebook each).
 */
export function evernoteImporter(htmlToContent: HtmlToContent): Importer {
  return {
    source: 'evernote',
    async plan(input) {
      const notebooks: Notebook[] = [];
      if (input.zip) {
        const zip = input.zip;
        const names = zip.names.filter((name) => /\.enex$/i.test(name)).sort();
        if (names.length === 0) throw new ImportFileError(NOT_ENEX);
        for (const name of names) {
          notebooks.push({ name: notebookName(name), notes: readEnex(await zip.text(name)) });
        }
      } else {
        notebooks.push({ name: notebookName(input.fileName), notes: readEnex(await input.text()) });
      }
      const asDatabase = input.options.asDatabase === true;
      return evernotePlan(notebooks, input.fileName, htmlToContent, { asDatabase });
    },
  };
}
