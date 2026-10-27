// A page's saved blocks, drawn read-only for the Print view with the design kit's classes, so the
// page prints as it shows (Import and export spec, section 3.3). A block it doesn't know shows its
// content. Links go only to Care Hub pages and files, and to web, mail and phone addresses.
import {
  attrNumber,
  attrText,
  colorsOf,
  fileIdOf,
  isContentId,
  isInline,
  pageIdOf,
  pagePathId,
  plainText,
  roleOf,
  type ContentMark,
  type ContentNode,
} from '@carehub/extras/import-export/export/content';
import { altOf, iconOf, texOf } from '@carehub/extras/import-export/export/render';
import { cn, colorClasses } from '@carehub/ui';
import { Paperclip, Square, SquareCheckBig } from 'lucide-react';
import type { ReactNode } from 'react';
import type { PrintLinkedPage } from './api';

interface PrintContext {
  /** The pages the content points at: their title if they can open them, else null. */
  pages: Readonly<Record<string, PrintLinkedPage | null>>;
  openAll: boolean;
}

const WEB_LINK = /^(?:https?:\/\/|mailto:|tel:)/i;
const FILE_PATH = /^\/api\/files\/[0-9a-f-]{36}(?:[?#].*)?$/i;

/** Where a link may go: a Care Hub page or file, or a web, mail or phone address; else null. */
export function printHref(href: string | undefined): string | null {
  const value = href?.trim();
  if (!value) return null;
  if (isContentId(pagePathId(value)) || FILE_PATH.test(value)) return value;
  return WEB_LINK.test(value) ? value : null;
}

function colorClass(node: ContentNode | ContentMark): string | undefined {
  const { text, bg } = colorsOf(node);
  return cn(text && colorClasses[text].text, bg && colorClasses[bg].bg) || undefined;
}

const MARK_TAGS: Partial<Record<string, 'strong' | 'em' | 's' | 'u'>> = {
  bold: 'strong',
  strong: 'strong',
  italic: 'em',
  em: 'em',
  strike: 's',
  strikethrough: 's',
  underline: 'u',
};

function Text({ node }: { node: ContentNode }) {
  let shown: ReactNode = node.text ?? '';
  let href: string | null = null;
  for (const mark of node.marks ?? []) {
    const Tag = MARK_TAGS[mark.type];
    if (Tag) {
      shown = <Tag>{shown}</Tag>;
    } else if (mark.type === 'code') {
      shown = <code className="rounded-sm bg-fill px-1 font-mono">{shown}</code>;
    } else if (mark.type === 'link') {
      href = printHref(attrText(mark, 'href'));
    } else {
      const color = colorClass(mark);
      if (color) shown = <span className={color}>{shown}</span>;
    }
  }
  return href ? (
    <a href={href} className="underline">
      {shown}
    </a>
  ) : (
    shown
  );
}

function PageLink({ id, page }: { id: string; page: PrintLinkedPage }) {
  return (
    <a href={`/p/${id}`} className="underline">
      {page.icon ? `${page.icon} ` : ''}
      {page.title}
    </a>
  );
}

function Mention({ node, ctx }: { node: ContentNode; ctx: PrintContext }) {
  const pageId = pageIdOf(node);
  if (pageId !== undefined) {
    const page = isContentId(pageId) ? ctx.pages[pageId] : null;
    return page ? (
      <PageLink id={pageId} page={page} />
    ) : (
      <span className="text-muted">No access</span>
    );
  }
  const label = attrText(node, 'label', 'name', 'date') ?? '';
  const person =
    ['userMention', 'personMention'].includes(node.type) || node.attrs?.kind === 'user';
  return (
    <span className="font-medium">{person && !label.startsWith('@') ? `@${label}` : label}</span>
  );
}

function Inline({ node, ctx }: { node: ContentNode; ctx: PrintContext }) {
  switch (roleOf(node)) {
    case 'text':
      return <Text node={node} />;
    case 'break':
      return <br />;
    case 'mathInline':
      return <code className="font-mono">{texOf(node)}</code>;
    case 'mention':
      return <Mention node={node} ctx={ctx} />;
    default:
      return plainText(node);
  }
}

function inline(nodes: readonly ContentNode[], ctx: PrintContext): ReactNode[] {
  return nodes.map((node, index) => <Inline key={index} node={node} ctx={ctx} />);
}

function List({ node, ctx }: { node: ContentNode; ctx: PrintContext }) {
  const items = (node.content ?? []).filter((item) => roleOf(item) === 'listItem');
  const tasks = roleOf(node) === 'taskList' || items.some((item) => item.type === 'taskItem');
  if (tasks) {
    return (
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => {
          const done = item.attrs?.checked === true;
          const Icon = done ? SquareCheckBig : Square;
          return (
            <li key={index} className="flex gap-2">
              <Icon aria-hidden className="mt-1 size-4 shrink-0" />
              <span className="sr-only">{done ? 'Done: ' : 'To do: '}</span>
              <Blocks
                nodes={item.content ?? []}
                ctx={ctx}
                className={cn('min-w-0 flex-1', done && 'text-muted line-through')}
              />
            </li>
          );
        })}
      </ul>
    );
  }
  const body = items.map((item, index) => (
    <li key={index}>
      <Blocks nodes={item.content ?? []} ctx={ctx} className="gap-1" />
    </li>
  ));
  if (roleOf(node) === 'bulletList') return <ul className="list-disc pl-6">{body}</ul>;
  return (
    <ol className="list-decimal pl-6" start={attrNumber(node, 'start')}>
      {body}
    </ol>
  );
}

function Toggle({ node, ctx }: { node: ContentNode; ctx: PrintContext }) {
  const [first, ...rest] = node.content ?? [];
  if (!first) return null;
  const titled = roleOf(first) === 'summary' || (first.content?.every(isInline) ?? false);
  const summary = titled ? inline(first.content ?? [], ctx) : [];
  return (
    <details open={ctx.openAll || node.attrs?.open === true}>
      <summary className="cursor-pointer">
        {summary.length > 0 ? summary : <span className="text-muted">Toggle</span>}
      </summary>
      <Blocks nodes={titled ? rest : [first, ...rest]} ctx={ctx} className="mt-2 pl-6" />
    </details>
  );
}

function Table({ node, ctx }: { node: ContentNode; ctx: PrintContext }) {
  const rows = (node.content ?? []).filter((row) => roleOf(row) === 'row');
  const [first, ...rest] = rows;
  if (!first) return null;
  const headed = first.content?.every((cell) => cell.type === 'tableHeader') ?? false;
  const cells = (row: ContentNode, head: boolean) =>
    (row.content ?? []).map((cell, index) => {
      const header = head || cell.type === 'tableHeader';
      const Tag = header ? 'th' : 'td';
      return (
        <Tag
          key={index}
          scope={header ? (head ? 'col' : 'row') : undefined}
          colSpan={attrNumber(cell, 'colspan')}
          rowSpan={attrNumber(cell, 'rowspan')}
          className={cn('border p-2 text-left align-top', header && 'font-semibold')}
        >
          <Blocks nodes={cell.content ?? []} ctx={ctx} className="gap-1" />
        </Tag>
      );
    });
  return (
    <table className="w-full table-fixed border-collapse break-words text-small">
      {headed && (
        <thead>
          <tr>{cells(first, true)}</tr>
        </thead>
      )}
      <tbody>
        {(headed ? rest : rows).map((row, index) => (
          <tr key={index}>{cells(row, false)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function Picture({ node }: { node: ContentNode }) {
  const fileId = fileIdOf(node);
  const source = attrText(node, 'src', 'url');
  const src = isContentId(fileId)
    ? `/api/files/${fileId}`
    : source && /^https?:\/\//i.test(source.trim())
      ? source.trim()
      : null;
  if (!src) return <p className="text-small text-muted">Picture not included</p>;
  const caption = attrText(node, 'caption');
  return (
    <figure className="flex flex-col gap-1">
      <img src={src} alt={altOf(node, 'Picture')} className="h-auto max-w-full rounded" />
      {caption && <figcaption className="text-small text-muted">{caption}</figcaption>}
    </figure>
  );
}

function Block({ node, ctx }: { node: ContentNode; ctx: PrintContext }): ReactNode {
  const children = node.content ?? [];
  const color = colorClass(node);
  switch (roleOf(node)) {
    case 'paragraph':
      return <p className={color}>{children.length > 0 ? inline(children, ctx) : <br />}</p>;
    case 'heading': {
      // The page title is the one h1, so content headings start at h2.
      const level = Math.min(3, Math.max(1, attrNumber(node, 'level') ?? 1));
      const Tag = (['h2', 'h3', 'h4'] as const)[level - 1] ?? 'h2';
      const size = ['text-h1', 'text-h2', 'text-h3'][level - 1];
      return <Tag className={cn('mt-4', size, color)}>{inline(children, ctx)}</Tag>;
    }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return <List node={node} ctx={ctx} />;
    case 'quote':
      return (
        <blockquote className={cn('border-l-2 border-fg pl-4', color)}>
          <Blocks nodes={children} ctx={ctx} />
        </blockquote>
      );
    case 'callout': {
      const { text, bg } = colorsOf(node);
      return (
        <div
          className={cn(
            'ch-print-callout flex gap-3 rounded p-4',
            bg ? colorClasses[bg].bg : 'bg-fill',
            text && colorClasses[text].text,
          )}
        >
          <span aria-hidden="true">{iconOf(node, '💡')}</span>
          <Blocks nodes={children} ctx={ctx} className="min-w-0 flex-1" />
        </div>
      );
    }
    case 'code':
      return (
        <pre className="whitespace-pre-wrap break-words rounded bg-fill p-4 font-mono text-small">
          <code>{plainText(node)}</code>
        </pre>
      );
    case 'math':
      return (
        <pre className="whitespace-pre-wrap break-words font-mono text-small">
          <code>{texOf(node)}</code>
        </pre>
      );
    case 'rule':
      return <hr className="my-2 border-border" />;
    case 'toggle':
      return <Toggle node={node} ctx={ctx} />;
    case 'columns':
      return (
        <div className="ch-print-columns flex flex-col gap-6 md:flex-row">
          {children.map((column, index) => (
            <Blocks key={index} nodes={column.content ?? []} ctx={ctx} className="min-w-0 flex-1" />
          ))}
        </div>
      );
    case 'table':
      return <Table node={node} ctx={ctx} />;
    case 'image':
      return <Picture node={node} />;
    case 'file': {
      // Files, videos and audio print as links.
      const fileId = fileIdOf(node);
      const href = isContentId(fileId)
        ? `/api/files/${fileId}`
        : printHref(attrText(node, 'src', 'url', 'href'));
      if (!href) return null;
      return (
        <p className="flex items-center gap-2">
          <Paperclip aria-hidden className="size-4 shrink-0" />
          <a href={href} className="underline">
            {attrText(node, 'name', 'fileName', 'title') ?? 'File'}
          </a>
        </p>
      );
    }
    case 'embed': {
      const href = printHref(attrText(node, 'url', 'src', 'href'));
      if (!href) return null;
      return (
        <p>
          <a href={href} className="underline">
            {attrText(node, 'title', 'caption') ?? href}
          </a>
        </p>
      );
    }
    case 'database':
    case 'page': {
      const id = pageIdOf(node);
      if (!isContentId(id)) return null;
      const page = ctx.pages[id];
      return (
        <p>
          {page ? <PageLink id={id} page={page} /> : <span className="text-muted">No access</span>}
        </p>
      );
    }
    case 'tab': {
      const title = attrText(node, 'title', 'label', 'name');
      return (
        <div className="flex flex-col gap-2">
          {title && <p className="font-semibold">{title}</p>}
          <Blocks nodes={children} ctx={ctx} />
        </div>
      );
    }
    case 'skip':
      return null;
    default:
      if (isInline(node)) return <p>{inline([node], ctx)}</p>;
      if (children.length > 0 && children.every(isInline)) return <p>{inline(children, ctx)}</p>;
      return <Blocks nodes={children} ctx={ctx} />;
  }
}

function Blocks({
  nodes,
  ctx,
  className,
}: {
  nodes: readonly ContentNode[];
  ctx: PrintContext;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {nodes.map((node, index) => (
        <Block key={index} node={node} ctx={ctx} />
      ))}
    </div>
  );
}

export interface PageBlocksProps {
  blocks: readonly ContentNode[];
  pages: Readonly<Record<string, PrintLinkedPage | null>>;
  /** Shows every toggle open; otherwise each is as it was left. */
  openAll: boolean;
}

export function PageBlocks({ blocks, pages, openAll }: PageBlocksProps) {
  return <Blocks nodes={blocks} ctx={{ pages, openAll }} />;
}
