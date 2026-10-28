// Builds an export (Import and export spec, section 3.3). Only what the exporter can open goes in:
// sub-pages they can't open are left out and counted in a README, pages in Trash never come, and
// databases come as CSV without the rows and properties they can't see, with a folder of row pages.
// Each page is a file named after its title, its sub-pages and files in a folder next to it, and
// every link between them relative, so the zip works offline.
import { atLeast } from '@carehub/shared';
import { blocksOf, referencesIn } from '@carehub/extras/import-export/export/content';
import { pageToHtml } from '@carehub/extras/import-export/export/html';
import { pageToMarkdown } from '@carehub/extras/import-export/export/markdown';
import {
  ExportNames,
  fileStem,
  joinPath,
  relativeLink,
  splitFileName,
} from '@carehub/extras/import-export/export/names';
import {
  exportHref,
  type ExportLinks,
  type FileRef,
  type PageRef,
} from '@carehub/extras/import-export/export/render';
import type { Db } from '../../../db';
import type { ExportFormat, ExportOptions } from './schema';
import { exportSources, type ExportPageInfo } from './sources';
import { EXPORT_STYLE } from './style';
import { ZipWriter } from './zip';

export interface ExportPlan {
  root: ExportPageInfo;
  /** The root first, then the pages that go in, parents before children. */
  pages: ExportPageInfo[];
  /** Where each page goes: its nearest ancestor in the export. */
  parentOf: Map<string, string>;
  /** Sub-pages left out because the exporter can't open them. */
  skipped: number;
}

/** What goes in: the root, and its sub-pages (or, for a database, its rows) they can open. */
export async function planExport(
  db: Db,
  userId: string,
  root: ExportPageInfo,
  options: Pick<ExportOptions, 'includeSubpages'>,
): Promise<ExportPlan> {
  const sources = exportSources();
  let under: ExportPageInfo[] = [];
  if (options.includeSubpages || root.kind === 'database') {
    under = (await sources.subtree(db, root.id)).filter((page) => page.id !== root.id);
    if (!options.includeSubpages) {
      under = under.filter((page) => page.kind === 'row' && page.parentId === root.id);
    }
  }
  const levels = await sources.access(
    db,
    userId,
    under.map((page) => page.id),
  );
  const kept = under.filter((page) => atLeast(levels.get(page.id) ?? 'none', 'view'));
  const keptIds = new Set([root.id, ...kept.map((page) => page.id)]);
  const parents = new Map(under.map((page) => [page.id, page.parentId]));
  const parentOf = new Map<string, string>();
  for (const page of kept) {
    let parent = page.parentId;
    while (parent !== null && !keptIds.has(parent)) parent = parents.get(parent) ?? null;
    parentOf.set(page.id, parent ?? root.id);
  }
  // Parents before children, whatever order the pages came in (a sort keeps siblings in order).
  const depth = (id: string): number => {
    const parent = parentOf.get(id);
    return parent === undefined ? 0 : 1 + depth(parent);
  };
  kept.sort((a, b) => depth(a.id) - depth(b.id));
  return { root, pages: [root, ...kept], parentOf, skipped: under.length - kept.length };
}

interface Placed {
  page: ExportPageInfo;
  /** The page's own file: `.md` or `.html`, or `.csv` for a database. */
  file: string;
  /** The folder for its sub-pages, rows and files. */
  folder: string;
}

export interface BuildOptions {
  format: ExportFormat;
  options: ExportOptions;
  maxBytes: number;
  onProgress?: (done: number, total: number) => void | Promise<void>;
  signal?: AbortSignal;
}

export interface BuiltExport {
  zip: Buffer;
  fileName: string;
  pageCount: number;
}

const COMPRESSED = /^(?:image\/(?!svg)|video\/|audio\/|application\/(?:zip|gzip|pdf))/;

/** RFC 4180 cells; a leading = + - @ is quoted with ' so a spreadsheet doesn't run it. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function readme(skipped: number): string {
  const left =
    skipped === 1
      ? "1 page was left out because you can't open it."
      : `${skipped} pages were left out because you can't open them.`;
  return `# About this export\n\n${left}\n`;
}

export async function buildExport(
  db: Db,
  userId: string,
  plan: ExportPlan,
  build: BuildOptions,
): Promise<BuiltExport> {
  const sources = exportSources();
  const { options } = build;
  const ext = build.format === 'markdown' ? '.md' : '.html';
  const names = new ExportNames();
  const zip = new ZipWriter({ maxBytes: build.maxBytes });
  if (plan.skipped > 0) {
    names.take('', 'README', ['.md']);
    await zip.add('README.md', readme(plan.skipped));
  }

  // Where each page goes, parents first, so a folder's names are handed out in page order.
  const placed = new Map<string, Placed>();
  for (const page of plan.pages) {
    const parent = placed.get(plan.parentOf.get(page.id) ?? '');
    const folder = parent?.folder ?? '';
    const own = page.kind === 'database' ? '.csv' : ext;
    const stem = names.take(folder, fileStem(page.title), [own, '']);
    placed.set(page.id, {
      page,
      file: joinPath(folder, `${stem}${own}`),
      folder: joinPath(folder, stem),
    });
  }

  // Pages outside the export that pages link to: a Care Hub link if they can open them.
  const outside = new Map<string, PageRef | null>();
  async function lookUp(pageIds: Iterable<string>) {
    const missing = [...pageIds].filter((id) => !placed.has(id) && !outside.has(id));
    if (missing.length === 0) return;
    const [levels, pages] = await Promise.all([
      sources.access(db, userId, missing),
      sources.pages(db, missing),
    ]);
    for (const id of missing) {
      const page = pages.get(id);
      const open = page !== undefined && atLeast(levels.get(id) ?? 'none', 'view');
      outside.set(
        id,
        open ? { title: page.title || 'Untitled', href: `${options.origin}/p/${id}` } : null,
      );
    }
  }

  let done = 0;
  for (const { page, file, folder } of placed.values()) {
    build.signal?.throwIfAborted();
    if (page.kind === 'database') {
      const viewId =
        page.id === plan.root.id && options.databases === 'view' ? options.viewId : undefined;
      const csv =
        (await sources.csv(db, { userId, databaseId: page.id, viewId })) ??
        [
          'Name',
          ...plan.pages
            .filter((row) => plan.parentOf.get(row.id) === page.id && row.kind === 'row')
            .map((row) => csvCell(row.title)),
        ].join('\r\n') + '\r\n';
      await zip.add(file, csv);
    } else {
      const blocks = blocksOf(await sources.content(db, page.id));
      const refs = referencesIn(blocks);
      await lookUp(refs.pageIds);
      const files = new Map<string, FileRef>();
      for (const fileId of refs.fileIds) {
        const found = options.includeFiles
          ? await sources.file(db, { userId, pageId: page.id, fileId })
          : null;
        if (!found) {
          if (!options.includeFiles)
            files.set(fileId, { name: 'File', href: `${options.origin}/api/files/${fileId}` });
          continue;
        }
        const { stem, ext: fileExt } = splitFileName(found.name);
        const name = `${names.take(folder, stem, [fileExt])}${fileExt}`;
        const path = joinPath(folder, name);
        await zip.add(path, found.data, { compress: !COMPRESSED.test(found.mimeType) });
        files.set(fileId, { name: found.name, href: relativeLink(file, path) });
      }
      const links: ExportLinks = {
        page: (id) => {
          const target = placed.get(id);
          if (target)
            return {
              title: target.page.title || 'Untitled',
              href: relativeLink(file, target.file),
            };
          return outside.get(id) ?? null;
        },
        file: (id) => files.get(id) ?? null,
        href: (href) => exportHref(href, options.origin),
      };
      const properties =
        page.kind === 'row' ? await sources.rowProperties(db, { userId, rowId: page.id }) : [];
      const content = { title: page.title, icon: page.icon, properties, blocks };
      await zip.add(
        file,
        build.format === 'markdown'
          ? pageToMarkdown(content, links)
          : pageToHtml(content, links, { style: EXPORT_STYLE }),
      );
    }
    done += 1;
    await build.onProgress?.(done, plan.pages.length);
  }
  return {
    zip: zip.finish(),
    fileName: `${fileStem(plan.root.title)}.zip`,
    pageCount: plan.pages.length,
  };
}
