// Reading a Confluence space's HTML export (Import and export spec, section 3.2; IE-06) with the
// browser's DOMParser, which makes an inert document: nothing in it runs or loads. The space's
// index.html lists its page tree under "Available Pages"; each page has its title, breadcrumbs,
// content and a list of its attachments.
import { entryOf } from '@carehub/extras/import-export/import/confluence/paths';
import { IMPORT_LIMITS, ImportFileError } from '@carehub/extras/import-export/import/plan';

const TOO_DEEP = 'pages can be nested up to 64 levels deep';

export const readHtml = (text: string) => new DOMParser().parseFromString(text, 'text/html');

/** The text of the page's own title, or of its `<title>`, without the "Space : " before it. */
export function titleOf(doc: Document, space: string): string {
  const title = (doc.querySelector('#title-text')?.textContent ?? doc.title)
    .replace(/\s+/g, ' ')
    .trim();
  const prefix = `${space} : `;
  return space && title.startsWith(prefix) ? title.slice(prefix.length).trim() : title;
}

/**
 * The page tree that the space's index.html lists under "Available Pages": each page's entry and
 * the entry of the page it's under (null at the top), in the tree's order.
 */
export function readPageTree(
  index: Document,
  indexEntry: string,
  names: ReadonlySet<string>,
): Map<string, string | null> {
  const tree = new Map<string, string | null>();
  const heading = Array.from(index.querySelectorAll('h1, h2, h3, h4, h5, h6')).find((element) =>
    /available pages/i.test(element.textContent ?? ''),
  );
  const list = (heading?.closest('.pageSection') ?? heading?.parentElement)?.querySelector('ul');
  const walk = (items: Element, parent: string | null, depth: number) => {
    if (depth > IMPORT_LIMITS.depth) throw new ImportFileError(TOO_DEEP);
    for (const item of Array.from(items.children)) {
      if (item.tagName !== 'LI') continue;
      const link = item.querySelector(':scope > a, :scope > span > a');
      const entry = entryOf(indexEntry, link?.getAttribute('href') ?? '', names);
      const here = entry !== null && entry !== indexEntry && !tree.has(entry) ? entry : null;
      if (here !== null) tree.set(here, parent);
      for (const sub of Array.from(item.children)) {
        if (sub.tagName === 'UL' || sub.tagName === 'OL') walk(sub, here ?? parent, depth + 1);
      }
    }
  };
  if (list) walk(list, null, 1);
  return tree;
}

export interface PageParts {
  title: string;
  /** The entry of the last page in its breadcrumbs, or null. */
  parent: string | null;
  /** The page's content. */
  body: Element;
  /** The attachments listed under the page, by entry, with their names. */
  attachments: Map<string, string>;
}

/** The parts of the page `entry` that the import uses. */
export function readPage(
  doc: Document,
  entry: string,
  names: ReadonlySet<string>,
  space: string,
): PageParts {
  let parent: string | null = null;
  for (const link of Array.from(doc.querySelectorAll('#breadcrumbs a[href]'))) {
    const target = entryOf(entry, link.getAttribute('href') ?? '', names);
    if (target !== null && target !== entry && !/(?:^|\/)index\.html?$/i.test(target)) {
      parent = target;
    }
  }
  const attachments = new Map<string, string>();
  const heading = doc.querySelector('#attachments');
  const section = heading?.closest('.pageSection') ?? heading?.parentElement?.parentElement;
  for (const link of Array.from(section?.querySelectorAll('a[href]') ?? [])) {
    const target = entryOf(entry, link.getAttribute('href') ?? '', names);
    const name = link.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    if (target !== null && target !== entry && !attachments.has(target)) {
      attachments.set(target, name || (target.split('/').at(-1) ?? target));
    }
  }
  const body = doc.querySelector('#main-content') ?? doc.querySelector('.wiki-content') ?? doc.body;
  return { title: titleOf(doc, space), parent, body, attachments };
}
