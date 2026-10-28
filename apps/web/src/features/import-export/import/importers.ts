import type { Importer, ImportSourceId } from '@carehub/extras/import-export/import/index';

/**
 * The importers the Import screen runs itself, for the sources it reads in the browser
 * (readsInBrowser): it uploads their plan, and the server writes it. Add a source here with its
 * importer; one that reads HTML is given htmlToContent (./html) for each page.
 */
export const BROWSER_IMPORTERS: Partial<Record<ImportSourceId, Importer>> = {};
