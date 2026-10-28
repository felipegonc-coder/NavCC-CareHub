import {
  IMPORT_LIMITS,
  clip,
  planLink,
  type ImportPlan,
  type ImportProblem,
  type PlanContent,
  type PlanFile,
  type PlanPage,
} from './plan';

/**
 * Imports of documents in folders (Text and Markdown, HTML): one page per document, folders with
 * documents inside as parent pages, and the pictures and files the documents link to as files.
 * Each importer reads its own documents (DocumentReader); this makes the tree and follows links.
 */

/** A file of the upload: a document with its text, or anything else by its path. */
export interface UploadEntry {
  path: string;
  /** Set for the documents the importer reads. */
  text?: string;
}

/**
 * The plan link for a path in the upload: its page, or its file, which then comes along. Null
 * when the upload has nothing there.
 */
export type LinkTarget = (path: string) => string | null;

/** A document as a page. */
export interface DocumentPage {
  /** Null for the document's name. */
  title: string | null;
  content: PlanContent;
  problems?: ImportProblem[];
}

export interface DocumentReader {
  /** The ending of the documents it reads, as /\.(md|txt)$/i (not a global pattern). */
  documents: RegExp;
  read(path: string, text: string, target: LinkTarget): DocumentPage;
  /** A document that is its own folder's page, as a website's index.html. */
  isFolderPage?(name: string): boolean;
  /** What the problems say about files no page links to; by default each is skipped. */
  unlinked?(paths: readonly string[]): ImportProblem[];
}

const PROGRAM = /\.(exe|dll|msi|com|scr|bat|cmd|ps1|vbs|jar|app|apk|sh|dmg|pkg)$/i;

/** Hidden files and folders, and the __MACOSX folder zips made on a Mac have. */
export const isSkipped = (path: string) =>
  path
    .split(/[\\/]/)
    .some((part) => part === '__MACOSX' || (part.startsWith('.') && part !== '.' && part !== '..'));

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

export const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')));
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

const eachSkipped = (paths: readonly string[]): ImportProblem[] =>
  paths.map((file) => ({ file, what: 'Skipped', why: 'No page links to it.' }));

interface Node {
  parent: string | null;
  /** The folder's name, or the document's name without its ending. */
  name: string;
  /** The document that is this page, if any. */
  path: string | null;
}

/**
 * The pages, files and problems of an upload of documents. A document next to a folder of the
 * same name ("Team.md" and "Team/") is that folder's page, and so is one the reader names
 * (isFolderPage) when the folder has no such document.
 */
export function planDocuments(entries: readonly UploadEntry[], reader: DocumentReader): ImportPlan {
  const problems: ImportProblem[] = [];
  const documents = new Map<string, string>();
  /** The other files, by path, with their names in the zip. */
  const assets = new Map<string, string>();
  for (const entry of entries) {
    if (entry.path.endsWith('/') || isSkipped(entry.path)) continue;
    const path = cleanPath(entry.path);
    if (path === null) {
      problems.push({ file: entry.path, what: 'Skipped', why: 'Its path points outside the zip.' });
    } else if (PROGRAM.test(path)) {
      problems.push({ file: path, what: 'Refused', why: "Programs can't be imported." });
    } else if (/\.zip$/i.test(path)) {
      problems.push({ file: path, what: 'Skipped', why: "Zips inside zips aren't opened." });
    } else if (entry.text !== undefined && reader.documents.test(path)) {
      documents.set(path, entry.text);
    } else {
      assets.set(path, entry.path);
    }
  }

  const folders = new Set<string>();
  for (const path of documents.keys()) {
    for (let folder = folderOf(path); folder !== ''; folder = folderOf(folder)) folders.add(folder);
  }
  /** The documents that are their folder's page, with the folder. */
  const ownFolder = new Map<string, string>();
  const hasPage = new Set<string>();
  for (const path of documents.keys()) {
    const sameName = path.replace(reader.documents, '');
    if (folders.has(sameName)) {
      ownFolder.set(path, sameName);
      hasPage.add(sameName);
    }
  }
  for (const path of [...documents.keys()].sort(byName)) {
    const folder = folderOf(path);
    if (folder === '' || hasPage.has(folder) || ownFolder.has(path)) continue;
    if (reader.isFolderPage?.(nameOf(path))) {
      ownFolder.set(path, folder);
      hasPage.add(folder);
    }
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
    const own = ownFolder.get(path);
    const name = nameOf(path.replace(reader.documents, ''));
    const key =
      own === undefined
        ? newNode({ parent: folderPage(folderOf(path)), name, path })
        : folderPage(own);
    const node = key === null ? undefined : nodes.get(key);
    if (key === null || !node) continue;
    node.path = path;
    pageOf.set(path, key);
  }

  const files = new Map<string, PlanFile>();
  const target: LinkTarget = (to) => {
    const page = pageOf.get(to);
    if (page) return planLink(page);
    const entry = assets.get(to);
    if (entry === undefined) return null;
    let file = files.get(to);
    if (!file) {
      file = { key: `f${files.size + 1}`, name: nameOf(to), entry };
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
      const page =
        node.path === null ? null : reader.read(node.path, documents.get(node.path) ?? '', target);
      problems.push(...(page?.problems ?? []));
      pages.push({
        key,
        parent,
        title: clip(page?.title ?? node.name, IMPORT_LIMITS.titleChars),
        content: page?.content ?? { markdown: '' },
        source: node.path ?? node.name,
      });
      add(key);
    }
  };
  add(null);
  const unlinked = [...assets.keys()].filter((path) => !files.has(path));
  problems.push(...(reader.unlinked ?? eachSkipped)(unlinked));
  return { pages, databases: [], files: [...files.values()], problems };
}
