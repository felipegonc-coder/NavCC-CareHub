import {
  isSkipped,
  linkTarget,
  planDocuments,
  type LinkTarget,
  type UploadEntry,
} from './documents';
import { IMPORT_LIMITS, ImportFileError, clip, type ImportPlan, type Importer } from './plan';

export { cleanPath, linkTarget } from './documents';

/**
 * Text and Markdown imports (IE-01): one page per file, titled by its first heading or its name.
 * Folders become parent pages, and a file next to a folder of the same name is that folder's page.
 * Links between the files point at the new pages; pictures and files they link to come along.
 */

/** A file of the upload: a document with its text, or anything else by its path. */
export type MarkdownEntry = UploadEntry;

const DOCUMENT = /\.(md|markdown|txt)$/i;

export const isDocumentPath = (path: string) => DOCUMENT.test(path);

/** A heading's text as a plain title: links as their text, no emphasis or code marks. */
const plainTitle = (text: string) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '')
    .replace(/\\(.)/g, '$1')
    .trim();

/** The first heading as the title, taken out of the text; otherwise null. */
function firstHeading(text: string): { title: string; body: string } | null {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim() !== '');
  const heading = /^ {0,3}#{1,6}\s+(.+?)(\s+#+)?\s*$/.exec(lines[first] ?? '');
  const title = heading?.[1] ? plainTitle(heading[1]) : '';
  return title ? { title, body: lines.slice(first + 1).join('\n') } : null;
}

/** Plain text as Markdown that reads back the same: punctuation escaped, line breaks kept. */
export function textAsMarkdown(text: string): string {
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) =>
      paragraph
        .split(/\r?\n/)
        .map((line) => line.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&'))
        .join('\\\n'),
    )
    .join('\n\n');
}

const LINK = /(!?\[[^\]\n]*\]\(\s*)(<[^>\n]*>|[^)\s]+)/g;
const DEFINITION = /^( {0,3}\[[^\]\n]+\]:\s*)(<[^>\n]*>|\S+)/;
const FENCE = /^ {0,3}(```|~~~)/;

/** The document's relative links, through `target` (a path to a plan link, or null to keep it). */
function rewriteLinks(path: string, text: string, target: LinkTarget): string {
  let inCode = false;
  const swap = (whole: string, start: string, href: string) => {
    const to = linkTarget(path, href.startsWith('<') ? href.slice(1, -1) : href);
    const link = to === null ? null : target(to);
    return link === null ? whole : `${start}${link}`;
  };
  return text
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) inCode = !inCode;
      return inCode ? line : line.replace(LINK, swap).replace(DEFINITION, swap);
    })
    .join('\n');
}

/** A document's page: .txt as plain text; Markdown titled by its first heading, with its links. */
function readMarkdown(path: string, text: string, target: LinkTarget) {
  const isText = /\.txt$/i.test(path);
  const heading = isText ? null : firstHeading(text);
  const body = isText ? textAsMarkdown(text) : (heading?.body ?? text);
  const markdown = isText ? body : rewriteLinks(path, body, target);
  const problems =
    markdown.length > IMPORT_LIMITS.pageChars
      ? [{ file: path, what: 'Cut short', why: 'Pages can have up to 1,000,000 characters.' }]
      : [];
  const content = { markdown: clip(markdown, IMPORT_LIMITS.pageChars) };
  return { title: heading?.title ?? null, content, problems };
}

/** The pages, files and problems of a Text and Markdown import. */
export function planMarkdown(entries: readonly MarkdownEntry[]): ImportPlan {
  return planDocuments(entries, { documents: DOCUMENT, read: readMarkdown });
}

/** Whether the import reads this entry's text: documents, but not hidden files or __MACOSX. */
const wantsText = (path: string) => DOCUMENT.test(path) && !isSkipped(path);

/** Text and Markdown: a .md or .txt file, or a .zip of them with their pictures. */
export const markdownImporter: Importer = {
  source: 'markdown',
  async plan(input) {
    const entries: MarkdownEntry[] = [];
    if (input.zip === null) {
      entries.push({ path: input.fileName, text: await input.text() });
    } else {
      for (const path of input.zip.names) {
        entries.push(wantsText(path) ? { path, text: await input.zip.text(path) } : { path });
      }
    }
    const plan = planMarkdown(entries);
    if (plan.pages.length === 0) {
      throw new ImportFileError('there are no Markdown or text files in it');
    }
    return plan;
  },
};
