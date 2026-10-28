import { markdownImporter } from './markdown';
import { notionImporter } from './notion';
import type { Importer } from './plan';
import type { ImportSourceId } from './sources';

/**
 * The importers the server runs, in its import worker (there's no DOM there). Add a source here
 * with its importer; the Import screen reads the others itself (readsInBrowser).
 */
export const SERVER_IMPORTERS: Partial<Record<ImportSourceId, Importer>> = {
  markdown: markdownImporter,
  notion: notionImporter,
};

/** Sources whose files are HTML or XML documents, read with the browser's DOMParser. */
const BROWSER_SOURCES: ReadonlySet<ImportSourceId> = new Set([
  'html',
  'word',
  'google-docs',
  'evernote',
  'confluence',
]);

/**
 * Whether the Import screen reads the file itself and uploads its plan. A Notion export is read
 * in the browser when it's the HTML kind and on the server when it's the Markdown and CSV kind.
 */
export function readsInBrowser(source: ImportSourceId, zipNames: readonly string[] | null) {
  if (source === 'notion') return zipNames?.some((name) => /\.html?$/i.test(name)) ?? false;
  return BROWSER_SOURCES.has(source);
}
