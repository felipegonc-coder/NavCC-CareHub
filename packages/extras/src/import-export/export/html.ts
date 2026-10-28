// A page as one HTML file (Import and export spec, section 3.3): its styling inside, no scripts,
// and links between exported pages that work offline. Every text and attribute is escaped, and a
// Content-Security-Policy turns scripts off even if a viewer adds some.
import {
  attrNumber,
  attrText,
  colorsOf,
  fileIdOf,
  isInline,
  pageIdOf,
  plainText,
  roleOf,
  type ContentMark,
  type ContentNode,
} from './content';
import {
  altOf,
  iconOf,
  languageOf,
  markHref,
  texOf,
  type ExportLinks,
  type ExportPage,
} from './render';

const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** An href that can't run anything; null for `javascript:` and other schemes. */
function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.trim())?.[1]?.toLowerCase();
  return scheme === undefined || ['http', 'https', 'mailto', 'tel'].includes(scheme) ? href : null;
}

function link(href: string | null | undefined, inner: string, className?: string): string {
  const safe = safeHref(href);
  if (safe === null) return inner;
  const cls = className ? ` class="${className}"` : '';
  return `<a${cls} href="${escapeHtml(safe)}">${inner}</a>`;
}

/** Palette classes for a block's or mark's colours (`ch-text-red ch-bg-blue`). */
function colorClasses(node: ContentNode | ContentMark): string[] {
  const { text, bg } = colorsOf(node);
  return [...(text ? [`ch-text-${text}`] : []), ...(bg ? [`ch-bg-${bg}`] : [])];
}

function classAttr(classes: readonly string[]): string {
  return classes.length > 0 ? ` class="${classes.join(' ')}"` : '';
}

const TAGS: Record<string, string> = {
  bold: 'strong',
  strong: 'strong',
  italic: 'em',
  em: 'em',
  strike: 's',
  strikethrough: 's',
  underline: 'u',
  code: 'code',
};

function text(node: ContentNode, links: ExportLinks): string {
  let html = escapeHtml(node.text ?? '');
  let href: string | null = null;
  for (const mark of node.marks ?? []) {
    const tag = TAGS[mark.type];
    if (tag) html = `<${tag}>${html}</${tag}>`;
    else if (mark.type === 'link') href = markHref(mark, links);
    else if (colorClasses(mark).length > 0) {
      html = `<span${classAttr(colorClasses(mark))}>${html}</span>`;
    }
  }
  return href === null ? html : link(href, html);
}

function inlineNode(node: ContentNode, links: ExportLinks): string {
  switch (roleOf(node)) {
    case 'text':
      return text(node, links);
    case 'break':
      return '<br>';
    case 'mathInline':
      return `<code class="math">${escapeHtml(texOf(node))}</code>`;
    case 'mention': {
      const pageId = pageIdOf(node);
      if (pageId !== undefined) {
        const page = links.page(pageId);
        return page
          ? link(page.href, escapeHtml(page.title), 'mention')
          : '<span class="mention">No access</span>';
      }
      const label = attrText(node, 'label', 'name', 'date') ?? '';
      const person =
        ['userMention', 'personMention'].includes(node.type) || node.attrs?.kind === 'user';
      const shown = person && !label.startsWith('@') ? `@${label}` : label;
      return `<span class="mention">${escapeHtml(shown)}</span>`;
    }
    default:
      return escapeHtml(plainText(node));
  }
}

export function inlineHtml(nodes: readonly ContentNode[], links: ExportLinks): string {
  return nodes.map((node) => inlineNode(node, links)).join('');
}

function list(node: ContentNode, links: ExportLinks): string {
  const role = roleOf(node);
  const items = (node.content ?? []).filter((item) => roleOf(item) === 'listItem');
  const tasks = role === 'taskList' || items.some((item) => item.type === 'taskItem');
  const body = items
    .map((item) => {
      const inner = blocksHtml(item.content ?? [], links);
      if (!tasks) return `<li>${inner}</li>`;
      const checked = item.attrs?.checked === true;
      const box = `<input type="checkbox" disabled${checked ? ' checked' : ''}>`;
      return `<li class="task${checked ? ' done' : ''}">${box}<div>${inner}</div></li>`;
    })
    .join('');
  if (tasks) return `<ul class="tasks">${body}</ul>`;
  if (role === 'bulletList') return `<ul>${body}</ul>`;
  const start = attrNumber(node, 'start') ?? 1;
  const type = attrText(node, 'type');
  const typeAttr = type === 'a' || type === 'i' ? ` type="${type}"` : '';
  return `<ol${start === 1 ? '' : ` start="${start}"`}${typeAttr}>${body}</ol>`;
}

function table(node: ContentNode, links: ExportLinks): string {
  const rows = (node.content ?? []).filter((row) => roleOf(row) === 'row');
  if (rows.length === 0) return '';
  const cells = (row: ContentNode) =>
    (row.content ?? [])
      .map((cell) => {
        const tag = cell.type === 'tableHeader' ? 'th' : 'td';
        return `<${tag}>${blocksHtml(cell.content ?? [], links)}</${tag}>`;
      })
      .join('');
  const [first, ...rest] = rows;
  const headed = first?.content?.every((cell) => cell.type === 'tableHeader') ?? false;
  const head = headed && first ? `<thead><tr>${cells(first)}</tr></thead>` : '';
  const body = (headed ? rest : rows).map((row) => `<tr>${cells(row)}</tr>`).join('');
  return `<table>${head}<tbody>${body}</tbody></table>`;
}

function toggle(node: ContentNode, links: ExportLinks): string {
  const [first, ...rest] = node.content ?? [];
  if (!first) return '';
  const hasSummary = roleOf(first) === 'summary' || (first.content?.every(isInline) ?? false);
  const summary = hasSummary ? inlineHtml(first.content ?? [], links) : '';
  const body = blocksHtml(hasSummary ? rest : [first, ...rest], links);
  const open = node.attrs?.open === true ? ' open' : '';
  return `<details${open}><summary>${summary}</summary><div class="toggle-body">${body}</div></details>`;
}

function fileBlock(node: ContentNode, links: ExportLinks, picture: boolean): string {
  const id = fileIdOf(node);
  const file = id === undefined ? null : links.file(id);
  const src = attrText(node, 'src', 'url');
  const href = file?.href ?? (id === undefined && src ? links.href(src) : null);
  if (!picture) {
    const name = attrText(node, 'name', 'fileName', 'title') ?? file?.name ?? src ?? 'File';
    return href ? `<p class="file">${link(href, escapeHtml(name))}</p>` : '';
  }
  const safe = safeHref(href);
  if (safe === null) return '<p class="missing">Picture not included</p>';
  const alt = escapeHtml(altOf(node, file?.name ?? 'Picture'));
  const caption = attrText(node, 'caption');
  const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return `<figure><img src="${escapeHtml(safe)}" alt="${alt}">${figcaption}</figure>`;
}

function block(node: ContentNode, links: ExportLinks): string {
  const children = node.content ?? [];
  const colors = colorClasses(node);
  switch (roleOf(node)) {
    case 'paragraph':
      return `<p${classAttr(colors)}>${inlineHtml(children, links)}</p>`;
    case 'heading': {
      // The page title is the one h1, so content headings start at h2.
      const level = Math.min(6, Math.max(2, (attrNumber(node, 'level') ?? 1) + 1));
      return `<h${level}${classAttr(colors)}>${inlineHtml(children, links)}</h${level}>`;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return list(node, links);
    case 'quote':
      return `<blockquote${classAttr(colors)}>${blocksHtml(children, links)}</blockquote>`;
    case 'callout': {
      const icon = `<span class="callout-icon" aria-hidden="true">${escapeHtml(iconOf(node, '💡'))}</span>`;
      const body = `<div class="callout-body">${blocksHtml(children, links)}</div>`;
      return `<aside${classAttr(['callout', ...colors])}>${icon}${body}</aside>`;
    }
    case 'code': {
      const language = languageOf(node);
      const cls = language ? ` class="language-${escapeHtml(language)}"` : '';
      return `<pre><code${cls}>${escapeHtml(plainText(node))}</code></pre>`;
    }
    case 'rule':
      return '<hr>';
    case 'toggle':
      return toggle(node, links);
    case 'columns':
      return `<div class="columns">${children.map((column) => `<div class="column">${blocksHtml(column.content ?? [], links)}</div>`).join('')}</div>`;
    case 'table':
      return table(node, links);
    case 'math':
      return `<pre class="math"><code>${escapeHtml(texOf(node))}</code></pre>`;
    case 'image':
      return fileBlock(node, links, true);
    case 'file':
      return fileBlock(node, links, false);
    case 'embed': {
      const url = attrText(node, 'url', 'src', 'href');
      const title = attrText(node, 'title', 'caption') ?? url ?? '';
      return url ? `<p class="embed">${link(links.href(url), escapeHtml(title))}</p>` : '';
    }
    case 'database':
    case 'page': {
      const id = pageIdOf(node);
      const page = id === undefined ? null : links.page(id);
      return page ? `<p class="page-link">${link(page.href, escapeHtml(page.title))}</p>` : '';
    }
    case 'tab': {
      const title = attrText(node, 'title', 'label', 'name');
      const heading = title ? `<p class="tab-title"><strong>${escapeHtml(title)}</strong></p>` : '';
      return `<section class="tab">${heading}${blocksHtml(children, links)}</section>`;
    }
    case 'skip':
      return '';
    default:
      if (isInline(node)) return `<p>${inlineNode(node, links)}</p>`;
      if (children.length > 0 && children.every(isInline)) {
        return `<p>${inlineHtml(children, links)}</p>`;
      }
      return blocksHtml(children, links);
  }
}

export function blocksHtml(nodes: readonly ContentNode[], links: ExportLinks): string {
  return nodes.map((node) => block(node, links)).join('\n');
}

export interface HtmlOptions {
  /** The stylesheet put inside the file. */
  style: string;
  lang?: string;
}

/** The whole page as an HTML file. */
export function pageToHtml(page: ExportPage, links: ExportLinks, options: HtmlOptions): string {
  const title = escapeHtml(page.title.replace(/\s+/g, ' ').trim() || 'Untitled');
  const icon = page.icon ? `<span class="page-icon">${escapeHtml(page.icon)}</span> ` : '';
  const properties = (page.properties ?? [])
    .map(
      ({ name, value }) => `<div><dt>${escapeHtml(name)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join('');
  const style = options.style.replace(/<\//g, '<\\/');
  return [
    '<!doctype html>',
    `<html lang="${escapeHtml(options.lang ?? 'en')}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`,
    `<title>${title}</title>`,
    `<style>${style}</style>`,
    '</head>',
    '<body>',
    '<main class="page">',
    `<h1 class="page-title">${icon}${title}</h1>`,
    properties ? `<dl class="properties">${properties}</dl>` : '',
    blocksHtml(page.blocks, links),
    '</main>',
    '</body>',
    '</html>',
    '',
  ]
    .filter((line, index, all) => line !== '' || index === all.length - 1)
    .join('\n');
}
