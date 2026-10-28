import {
  folderOf,
  isSkipped,
  linkTarget,
  planDocuments,
  type DocumentReader,
  type UploadEntry,
} from '@carehub/extras/import-export/import/documents';
import {
  ImportFileError,
  type ImportProblem,
  type Importer,
} from '@carehub/extras/import-export/import/index';
import { htmlToContent } from './html';

// HTML imports (Import and export spec, section 3.2; IE-03): an .html file, or a .zip of pages
// with their pictures, such as a saved web page or a website. One page per HTML file, with folders
// as parent pages and a folder's index.html as its page. Links between the files point at the new
// pages, and the pictures and files they link to come along.

const PAGE = /\.html?$/i;

/** A website's look and code: pages keep what it says, not these. */
const LOOK = /\.(css|js|mjs|map|woff2?|ttf|otf|eot)$/i;

/** The page's title: its <title>, or its first heading, or null for the file's name. */
export function htmlTitle(html: string): string | null {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const title = parsed.title || parsed.querySelector('h1')?.textContent || '';
  return title.replace(/\s+/g, ' ').trim() || null;
}

/** The folder all the paths are in, or '' when they share none. */
function commonFolder(paths: readonly string[]): string {
  return paths.map(folderOf).reduce((common, folder) => {
    let shared = common;
    while (shared !== '' && folder !== shared && !folder.startsWith(`${shared}/`)) {
      shared = folderOf(shared);
    }
    return shared;
  });
}

/** Files no page links to are each skipped; a website's styles and scripts are listed once. */
function unlinked(paths: readonly string[]): ImportProblem[] {
  const look = paths.filter((path) => LOOK.test(path));
  const problems: ImportProblem[] = paths
    .filter((path) => !LOOK.test(path))
    .map((file) => ({ file, what: 'Skipped', why: 'No page links to it.' }));
  const first = look[0];
  if (first !== undefined) {
    const kind = look.length === 1 ? 'style or script file' : 'style and script files';
    problems.push({
      file: look.length === 1 ? first : commonFolder(look) || first,
      what: `${look.length.toLocaleString('en-US')} ${kind} left out`,
      why: 'Pages keep what the HTML says, not how it looked or what its scripts did.',
    });
  }
  return problems;
}

const reader: DocumentReader = {
  documents: PAGE,
  isFolderPage: (name) => /^index\.html?$/i.test(name),
  read(path, text, target) {
    const { content, problems } = htmlToContent(text, {
      source: path,
      // Web addresses go through as they are; html.ts keeps only the safe ones.
      link: (href) => {
        const to = linkTarget(path, href.trim());
        return to === null ? href : target(to);
      },
    });
    return { title: htmlTitle(text), content, problems };
  },
  unlinked,
};

/** HTML: an .html file, or a .zip of pages with their pictures. */
export const htmlImporter: Importer = {
  source: 'html',
  async plan(input) {
    const entries: UploadEntry[] = [];
    if (input.zip === null) {
      entries.push({ path: input.fileName, text: await input.text() });
    } else {
      for (const path of input.zip.names) {
        const read = PAGE.test(path) && !isSkipped(path);
        entries.push(read ? { path, text: await input.zip.text(path) } : { path });
      }
    }
    const plan = planDocuments(entries, reader);
    if (plan.pages.length === 0) throw new ImportFileError('there are no HTML pages in it');
    return plan;
  },
};
