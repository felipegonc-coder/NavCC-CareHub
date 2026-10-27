import {
  IMPORT_LIMITS,
  ImportFileError,
  clip,
  planLink,
  type ImportPlan,
  type ImportProblem,
  type Importer,
  type PlanFile,
  type PlanPage,
} from './plan';

/**
 * Text and Markdown imports (IE-01): one page per file, titled by its first heading or its name.
 * Folders become parent pages, and a file next to a folder of the same name is that folder's page.
 * Links between the files point at the new pages; pictures and files they link to come along.
 */

/** A file of the upload: a document with its text, or anything else by its path. */
export interface MarkdownEntry {
  path: string;
  /** Set for .md, .markdown and .txt files. */
  text?: string;
}

const DOCUMENT = /\.(md|markdown|txt)$/i;
const PROGRAM = /\.(exe|dll|msi|com|scr|bat|cmd|ps1|vbs|jar|app|apk|sh)$/i;

/** Hidden files and folders, and the __MACOSX folder zips made on a Mac have. */
const isSkipped = (path: string) =>
  path
    .split(/[\\/]/)
    .some((part) => part === '__MACOSX' || (part.startsWith('.') && part !== '.' && part !== '..'));

export const isDocumentPath = (path: string) => DOCUMENT.test(path);

/** A path inside the upload in its usual form, or null when it points outside it. */
export function cleanPath(path: string): string | null {
  if (/^([/\\]|[a-z]:)/i.test(path)) return null;
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') parts.push(part);
    else if (parts.pop() === undefined) return null;
  }
  return parts.length > 0 ? parts.join('/') : null;
}

const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const byName = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });

/** Where a relative link in the file `from` points, or null for other sites, anchors and "/…". */
export function linkTarget(from: string, href: string): string | null {
  if (/^([a-z][a-z\d+.-]*:|[/\\#?])/i.test(href)) return null;
  const path = href.replace(/[?#].*$/, '');
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Kept as written.
  }
  const folder = folderOf(from);
  return cleanPath(folder ? `${folder}/${decoded}` : decoded);
}

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
function rewriteLinks(path: string, text: string, target: (to: string) => string | null): string {
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

interface Node {
  parent: string | null;
  /** The folder's name, or the document's name without its ending. */
  name: string;
  /** The document that is this page, if any. */
  path: string | null;
}

/** The pages, files and problems of a Text and Markdown import. */
export function planMarkdown(entries: readonly MarkdownEntry[]): ImportPlan {
  const problems: ImportProblem[] = [];
  const documents = new Map<string, string>();
  const assets = new Set<string>();
  for (const entry of entries) {
    if (entry.path.endsWith('/') || isSkipped(entry.path)) continue;
    const path = cleanPath(entry.path);
    if (path === null) {
      problems.push({ file: entry.path, what: 'Skipped', why: 'Its path points outside the zip.' });
    } else if (PROGRAM.test(path)) {
      problems.push({ file: path, what: 'Refused', why: "Programs can't be imported." });
    } else if (/\.zip$/i.test(path)) {
      problems.push({ file: path, what: 'Skipped', why: "Zips inside zips aren't opened." });
    } else if (entry.text !== undefined && DOCUMENT.test(path)) {
      documents.set(path, entry.text);
    } else {
      assets.add(path);
    }
  }

  // Folders with a document somewhere inside become pages; "X.md" next to "X/" is one page.
  const folders = new Set<string>();
  for (const path of documents.keys()) {
    for (let folder = folderOf(path); folder !== ''; folder = folderOf(folder)) folders.add(folder);
  }
  const nodes = new Map<string, Node>();
  const pageOf = new Map<string, string>();
  const newNode = (node: Node) => {
    const key = `p${nodes.size + 1}`;
    nodes.set(key, node);
    return key;
  };
  const folderPage = (folder: string): string | null => {
    if (folder === '') return null;
    const known = pageOf.get(folder);
    if (known) return known;
    const key = newNode({ parent: folderPage(folderOf(folder)), name: nameOf(folder), path: null });
    pageOf.set(folder, key);
    return key;
  };
  for (const path of [...documents.keys()].sort(byName)) {
    const sameName = path.replace(DOCUMENT, '');
    const key = folders.has(sameName)
      ? folderPage(sameName)
      : newNode({ parent: folderPage(folderOf(path)), name: nameOf(sameName), path });
    const node = key === null ? undefined : nodes.get(key);
    if (key === null || !node) continue;
    node.path = path;
    pageOf.set(path, key);
  }

  const files = new Map<string, PlanFile>();
  const target = (to: string): string | null => {
    const page = pageOf.get(to);
    if (page) return planLink(page);
    if (!assets.has(to)) return null;
    let file = files.get(to);
    if (!file) {
      file = { key: `f${files.size + 1}`, name: nameOf(to), entry: to };
      files.set(to, file);
    }
    return planLink(file.key);
  };

  const pages: PlanPage[] = [];
  const byParent = new Map<string | null, string[]>();
  for (const [key, node] of nodes)
    byParent.set(node.parent, [...(byParent.get(node.parent) ?? []), key]);
  const add = (parent: string | null) => {
    const keys = byParent.get(parent) ?? [];
    keys.sort((a, b) => byName(nodes.get(a)?.name ?? '', nodes.get(b)?.name ?? ''));
    for (const key of keys) {
      const node = nodes.get(key);
      if (!node) continue;
      const text = node.path === null ? '' : (documents.get(node.path) ?? '');
      const isText = node.path !== null && /\.txt$/i.test(node.path);
      const heading = isText ? null : firstHeading(text);
      const body = isText ? textAsMarkdown(text) : (heading?.body ?? text);
      const markdown = node.path === null || isText ? body : rewriteLinks(node.path, body, target);
      if (markdown.length > IMPORT_LIMITS.pageChars) {
        const why = 'Pages can have up to 1,000,000 characters.';
        problems.push({ file: node.path ?? node.name, what: 'Cut short', why });
      }
      pages.push({
        key,
        parent,
        title: clip(heading?.title ?? node.name, IMPORT_LIMITS.titleChars),
        content: { markdown: clip(markdown, IMPORT_LIMITS.pageChars) },
        source: node.path ?? node.name,
      });
      add(key);
    }
  };
  add(null);
  for (const path of assets) {
    if (!files.has(path))
      problems.push({ file: path, what: 'Skipped', why: 'No page links to it.' });
  }
  return { pages, databases: [], files: [...files.values()], problems };
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
