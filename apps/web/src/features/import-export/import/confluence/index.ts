// A Confluence space's HTML export as an import plan (Import and export spec, section 3.2; IE-06),
// made on the Import screen: a page for the space with its page tree under it, attachments as
// files, links between pages kept, info, note and warning panels as callouts and code macros as
// code blocks. Other macros keep their text, and the summary lists each kind once.
import { entryOf, spaceFolder } from '@carehub/extras/import-export/import/confluence/paths';
import {
  contentSize,
  IMPORT_LIMITS,
  ImportFileError,
  PLAN_LINK,
  planLink,
  type ImportPlan,
  type ImportZip,
  type Importer,
} from '@carehub/extras/import-export/import/plan';
import { fitPage } from '@carehub/extras/import-export/import/writer/fit-page';
import type { HtmlToContent } from '@carehub/extras/import-export/import/writer/html-reader';
import { PlanWriter, shortName } from '@carehub/extras/import-export/import/writer/plan-writer';
import { rewriteMacros } from './macros';
import { readHtml, readPage, readPageTree, titleOf } from './space';

export const NOT_CONFLUENCE = "the zip isn't a Confluence space's HTML export";
const TOO_MANY_PAGES = 'imports can have up to 10,000 pages';
const TOO_MANY_FILES = 'imports can have up to 50,000 files';
const WEB_ADDRESS = /^(?:https?:|mailto:|tel:)/i;
const HTML = /\.html?$/i;

const counted = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** The zip's name without its folders and its .zip ending. */
const zipName = (fileName: string) =>
  (fileName.split('/').at(-1) ?? fileName).replace(/\.zip$/i, '').trim();

/** The plan for the Confluence space in `zip`, read with the Import screen's HTML reader. */
export async function confluencePlan(
  zip: ImportZip,
  fileName: string,
  htmlToContent: HtmlToContent,
): Promise<ImportPlan> {
  const out = new PlanWriter(fileName);
  const names = new Set(zip.names);
  const folder = spaceFolder(zip.names);
  const indexEntry = zip.names.find(
    (name) => name.startsWith(folder) && /^index\.html?$/i.test(name.slice(folder.length)),
  );
  // Pages sit in the space's folder; HTML files deeper in are attachments.
  const isPage = (entry: string) =>
    HTML.test(entry) && entry.startsWith(folder) && !entry.slice(folder.length).includes('/');
  const entries = zip.names.filter((name) => name !== indexEntry && isPage(name)).sort();
  if (entries.length === 0) throw new ImportFileError(NOT_CONFLUENCE);
  if (entries.length + 1 > IMPORT_LIMITS.pages) throw new ImportFileError(TOO_MANY_PAGES);

  const index = indexEntry ? readHtml(await zip.text(indexEntry)) : null;
  const space = (index ? titleOf(index, '') : '') || zipName(fileName) || 'Confluence';
  const tree =
    index && indexEntry ? readPageTree(index, indexEntry, names) : new Map<string, string | null>();
  const pages = new Set(entries);
  const order = [...tree.keys()].filter((entry) => pages.has(entry));
  for (const entry of entries) if (!tree.has(entry)) order.push(entry);

  const spaceKey = out.key('space');
  const keys = new Map(order.map((entry) => [entry, out.key('page')]));
  const files = new Map<string, string>();
  const kept = new Map<string, number>();
  let missing = 0;
  let confluence = index !== null;
  out.plan.pages.push({
    key: spaceKey,
    parent: null,
    title: out.text(space, IMPORT_LIMITS.titleChars, `Space "${shortName(space)}"`),
    content: { markdown: '' },
    source: indexEntry ?? fileName,
  });

  const parents = new Map<string, string>();
  for (const entry of order) {
    const doc = readHtml(await zip.text(entry));
    confluence ||= doc.querySelector('#main-content') !== null;
    const page = readPage(doc, entry, names, space);
    const fallback = (entry.split('/').at(-1) ?? entry).replace(HTML, '').replace(/_\d+$/, '');
    const title = page.title || fallback;
    const item = `Page "${shortName(title)}"`;
    for (const [name, count] of rewriteMacros(page.body))
      kept.set(name, (kept.get(name) ?? 0) + count);

    /** Plan links to the files this page links to. */
    const fileLinks = new Set<string>();
    const fileLink = (target: string) => {
      let key = files.get(target);
      if (key === undefined) {
        if (out.plan.files.length >= IMPORT_LIMITS.files) throw new ImportFileError(TOO_MANY_FILES);
        key = out.key('file');
        files.set(target, key);
        const name = page.attachments.get(target) ?? target.split('/').at(-1) ?? target;
        const short = out.text(name, IMPORT_LIMITS.fileNameChars, item);
        out.plan.files.push({ key, name: short, entry: target });
      }
      fileLinks.add(planLink(key));
      return planLink(key);
    };
    const link = (href: string) => {
      const address = href.trim();
      if (address.startsWith(PLAN_LINK)) return fileLinks.has(address) ? address : null;
      const target = entryOf(entry, address, names);
      if (target === null) {
        if (WEB_ADDRESS.test(address)) return address;
        if (address !== '' && !address.startsWith('#') && !/^[a-z][a-z\d+.-]*:/i.test(address)) {
          missing += 1;
        }
        return null;
      }
      const pageKey = target === indexEntry ? spaceKey : keys.get(target);
      if (pageKey !== undefined) return planLink(pageKey);
      return isPage(target) ? null : fileLink(target);
    };

    // Attachments the page doesn't show or link to go at its end, as Confluence lists them.
    const shown = new Set(
      Array.from(page.body.querySelectorAll('a[href], img[src]'), (element) =>
        entryOf(entry, element.getAttribute('href') ?? element.getAttribute('src') ?? '', names),
      ),
    );
    const rest = [...page.attachments].filter(([target]) => !shown.has(target) && !isPage(target));
    if (rest.length > 0) {
      const heading = doc.createElement('h2');
      heading.textContent = 'Attachments';
      const list = doc.createElement('ul');
      for (const [target, name] of rest) {
        const anchor = doc.createElement('a');
        anchor.setAttribute('href', fileLink(target));
        anchor.textContent = name;
        const line = doc.createElement('li');
        line.append(anchor);
        list.append(line);
      }
      page.body.append(heading, list);
    }

    const read = htmlToContent(page.body.innerHTML, { source: out.where(item), link });
    out.add(read.problems);
    const content = fitPage(read.content, out, item);
    out.spend(contentSize(content));
    const key = keys.get(entry) ?? out.key('page');
    const parent = tree.has(entry) ? tree.get(entry) : page.parent;
    const found = parent === null || parent === undefined ? undefined : keys.get(parent);
    const parentKey = found === key ? undefined : found;
    if (parentKey !== undefined) parents.set(key, parentKey);
    out.plan.pages.push({
      key,
      parent: parentKey ?? spaceKey,
      title: out.text(title, IMPORT_LIMITS.titleChars, item),
      content,
      source: entry,
    });
  }
  if (!confluence) throw new ImportFileError(NOT_CONFLUENCE);
  breakLoops(out.plan.pages, parents, spaceKey);

  for (const [name, count] of [...kept].sort(([a], [b]) => a.localeCompare(b))) {
    const what = counted(count, `${name} macro`, `${name} macros`);
    out.problem(null, 'Kept as text', `${what} came in as text.`);
  }
  if (missing > 0) {
    const what = counted(missing, 'link goes', 'links go');
    out.problem(null, 'Kept as text', `${what} to pages or files that aren't in the export.`);
  }
  return out.done();
}

/** A page whose breadcrumbs go round in a loop back to it goes right under the space instead. */
function breakLoops(
  pages: ImportPlan['pages'],
  parents: Map<string, string>,
  spaceKey: string,
): void {
  for (const page of pages) {
    const seen = new Set<string>();
    for (let at = parents.get(page.key); at !== undefined && !seen.has(at); at = parents.get(at)) {
      if (at === page.key) {
        page.parent = spaceKey;
        parents.delete(page.key);
        break;
      }
      seen.add(at);
    }
  }
}

/** The Confluence importer, with the Import screen's HTML reader. It reads the space's .zip. */
export function confluenceImporter(htmlToContent: HtmlToContent): Importer {
  return {
    source: 'confluence',
    async plan(input) {
      if (!input.zip) throw new ImportFileError(NOT_CONFLUENCE);
      return confluencePlan(input.zip, input.fileName, htmlToContent);
    },
  };
}
