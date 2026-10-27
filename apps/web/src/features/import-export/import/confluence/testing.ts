// Small fictional Confluence exports for the tests.
import type { ImportZip } from '@carehub/extras/import-export/import/plan';

/** A zip of these entries, as the Import screen reads it. */
export function zipOf(entries: Record<string, string>): ImportZip {
  const encoder = new TextEncoder();
  return {
    names: Object.keys(entries),
    read: (name) => Promise.resolve(encoder.encode(entries[name] ?? '')),
    text: (name) => Promise.resolve(entries[name] ?? ''),
  };
}

/** The space's index.html, with its page tree: [file, title, children]. */
export type TreeItem = [string, string, TreeItem[]?];

const list = (items: readonly TreeItem[]): string =>
  `<ul>${items
    .map(
      ([file, title, children]) =>
        `<li><a href="${file}">${title}</a>${children ? list(children) : ''}</li>`,
    )
    .join('')}</ul>`;

export const indexHtml = (space: string, tree: readonly TreeItem[]) =>
  `<html><head><title>${space}</title></head><body><div id="main-header"><h1 id="title-heading">` +
  `<span id="title-text">${space}</span></h1></div><div class="pageSection">` +
  `<div class="pageSectionHeader"><h2 class="pageSectionTitle">Available Pages:</h2></div>` +
  `${list(tree)}</div></body></html>`;

/** A page as Confluence exports it: breadcrumbs, title, content and its attachments. */
export function pageHtml(
  space: string,
  title: string,
  content: string,
  options: { crumbs?: [string, string][]; attachments?: [string, string][] } = {},
): string {
  const crumbs = [['index.html', space], ...(options.crumbs ?? [])]
    .map(([file, name]) => `<li><span><a href="${file}">${name}</a></span></li>`)
    .join('');
  const files = (options.attachments ?? [])
    .map(
      ([file, name]) =>
        `<img src="images/icons/bullet_blue.gif" alt=""/> <a href="${file}">${name}</a><br/>`,
    )
    .join('');
  const attachments = files
    ? `<div class="pageSection group"><div class="pageSectionHeader">` +
      `<h2 id="attachments" class="pageSectionTitle">Attachments:</h2></div>` +
      `<div class="greybox">${files}</div></div>`
    : '';
  return (
    `<html><head><title>${space} : ${title}</title></head><body><div id="page">` +
    `<div id="main-header"><div id="breadcrumb-section"><ol id="breadcrumbs">${crumbs}</ol></div>` +
    `<h1 id="title-heading" class="pagetitle"><span id="title-text"> ${space} : ${title} </span></h1>` +
    `</div><div id="content" class="view"><div id="main-content" class="wiki-content group">` +
    `${content}</div>${attachments}</div></div></body></html>`
  );
}
