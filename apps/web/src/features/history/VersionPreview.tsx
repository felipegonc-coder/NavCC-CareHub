// A version's page, read-only (HT-04, HT-07): real rich text, drawn with the same elements the
// editor reads when pasting, so copied blocks keep their formatting. With Show changes, added text
// is green, removed text is struck through in red (and left out of copies), and changed blocks get
// a bar in the margin. Screen readers hear "added" and "removed".
import {
  diffDocs,
  diffText,
  type BlockChange,
  type DiffBlock,
  type HistoryDoc,
  type HistoryMark,
  type HistoryNode,
  type TextPiece,
} from '@carehub/extras/history';
import { cn, VisuallyHidden } from '@carehub/ui';
import { createElement, useMemo, type ReactNode } from 'react';

export interface PreviewPage {
  title: string;
  content: HistoryDoc;
}

export interface VersionPreviewProps {
  page: PreviewPage;
  /** The version before it; Show changes compares with it. */
  previous: PreviewPage | null;
  showChanges: boolean;
  className?: string;
}

const CHANGE_CLASSES: Record<BlockChange, string> = {
  same: '',
  added: 'bg-green-bg',
  removed: 'select-none bg-red-bg text-red-text line-through',
  changed: 'border-l-2 border-blue-text pl-2',
};

/** Only web, mail, phone and Care Hub links are drawn as links. */
function safeHref(href: unknown): string | null {
  if (typeof href !== 'string') return null;
  if (href.startsWith('/') && !href.startsWith('//')) return href;
  return /^(?:https?:|mailto:|tel:)/i.test(href) ? href : null;
}

function Marker({ change }: { change: 'added' | 'removed' }) {
  // Spaces around it, so it's heard as its own word; it's never selected, so never copied.
  return <VisuallyHidden className="select-none">{` ${change} `}</VisuallyHidden>;
}

function withMark(mark: HistoryMark, child: ReactNode, key: string): ReactNode {
  switch (mark.type) {
    case 'bold':
      return <strong key={key}>{child}</strong>;
    case 'italic':
      return <em key={key}>{child}</em>;
    case 'underline':
      return <u key={key}>{child}</u>;
    case 'strike':
      return <s key={key}>{child}</s>;
    case 'code':
      return (
        <code key={key} className="rounded-sm bg-fill px-1 font-mono text-small">
          {child}
        </code>
      );
    case 'link': {
      const href = safeHref(mark.attrs?.href);
      return href ? (
        <a key={key} href={href} className="text-fg underline" target="_blank" rel="noreferrer">
          {child}
        </a>
      ) : (
        child
      );
    }
    default:
      return child;
  }
}

function inline(node: HistoryNode, key: string): ReactNode {
  if (node.type === 'text') {
    return (node.marks ?? []).reduceRight<ReactNode>(
      (child, mark, index) => withMark(mark, child, `${key}-${index}`),
      node.text ?? '',
    );
  }
  if (node.type === 'hardBreak') return <br key={key} />;
  if (node.type === 'mention') {
    return (
      <span key={key} className="font-medium">
        @{String(node.attrs?.label ?? '')}
      </span>
    );
  }
  return node.text ?? '';
}

/** Compared text: each run of added or removed pieces in one <ins> or <del>, heard once. */
function pieces(list: readonly TextPiece[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let start = 0;
  while (start < list.length) {
    const change = list[start]?.change ?? 'same';
    let end = start;
    while (end < list.length && list[end]?.change === change) end += 1;
    const run = list.slice(start, end).map((one, at) => inline(one.node, `${key}-${start + at}`));
    if (change === 'same') {
      out.push(...run);
    } else {
      const Tag = change === 'added' ? 'ins' : 'del';
      out.push(
        <Tag
          key={`${key}-${start}-${change}`}
          className={cn(
            'rounded-sm',
            change === 'added'
              ? 'bg-green-bg text-green-text no-underline'
              : 'select-none bg-red-bg text-red-text line-through',
          )}
        >
          <Marker change={change} />
          {run}
        </Tag>,
      );
    }
    start = end;
  }
  return out;
}

const humanize = (type: string) =>
  type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (first) => first.toUpperCase());

/** The element for a block, around its children. */
function element(node: HistoryNode, classes: string, children: ReactNode[], key: string) {
  const attrs = node.attrs ?? {};
  const className = classes || undefined;
  switch (node.type) {
    case 'paragraph':
      return createElement('p', { key, className: cn('min-h-6', className) }, ...children);
    case 'heading': {
      // Stored levels 1 to 3 are drawn as <h2> to <h4>: the page title is the <h1>.
      const level = [1, 2, 3].includes(Number(attrs.level)) ? Number(attrs.level) : 1;
      const size = ['text-h1', 'text-h2', 'text-h3'][level - 1];
      return createElement(
        `h${level + 1}`,
        { key, 'data-level': level, className: cn(size, 'mt-2', className) },
        ...children,
      );
    }
    case 'bulletList':
      return createElement('ul', { key, className: cn('list-disc pl-6', className) }, ...children);
    case 'orderedList': {
      const start = typeof attrs.start === 'number' ? attrs.start : undefined;
      const type = typeof attrs.type === 'string' ? attrs.type : undefined;
      const props = { key, start, type, className: cn('list-decimal pl-6', className) };
      return createElement('ol', props, ...children);
    }
    case 'taskList':
      return createElement('ul', { key, 'data-type': 'taskList', className }, ...children);
    case 'taskItem': {
      const checked = attrs.checked === true;
      return (
        <li
          key={key}
          data-type="taskItem"
          data-checked={checked}
          className={cn('flex gap-2', className)}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled
            aria-label={checked ? 'Done' : 'Not done'}
            className="mt-1"
          />
          <div className="min-w-0 flex-1">{children}</div>
        </li>
      );
    }
    case 'listItem':
      return createElement('li', { key, className }, ...children);
    case 'blockquote':
      return createElement(
        'blockquote',
        { key, className: cn('border-l-2 border-border pl-4', className) },
        ...children,
      );
    case 'codeBlock':
      return (
        <pre key={key} className={cn('overflow-x-auto rounded bg-fill p-3', className)}>
          <code
            className={cn(
              'font-mono text-small',
              typeof attrs.language === 'string' && `language-${attrs.language}`,
            )}
          >
            {children}
          </code>
        </pre>
      );
    case 'horizontalRule':
      return (
        <div key={key} className={className}>
          {children}
          <hr className="my-2 border-border" />
        </div>
      );
    case 'table':
      return (
        <table key={key} className={cn('w-full border-collapse', className)}>
          <tbody>{children}</tbody>
        </table>
      );
    case 'tableRow':
      return createElement('tr', { key, className }, ...children);
    case 'tableCell':
    case 'tableHeader':
      return createElement(
        node.type === 'tableHeader' ? 'th' : 'td',
        { key, className: cn('border border-border p-2 text-left align-top', className) },
        ...children,
      );
    default: {
      if (node.content) {
        return createElement('div', { key, 'data-type': node.type, className }, ...children);
      }
      // A block the preview can't draw, such as a database: its name, and its title if it has one.
      const label = typeof attrs.title === 'string' && attrs.title ? attrs.title : null;
      return (
        <div
          key={key}
          data-type={node.type}
          className={cn('rounded border border-border px-3 py-2 text-small text-muted', className)}
        >
          {children}
          {label ? `${humanize(node.type)}: ${label}` : humanize(node.type)}
        </div>
      );
    }
  }
}

const INLINE = new Set(['text', 'hardBreak', 'mention', 'emoji', 'inlineMath', 'date']);
const isInline = (node: HistoryNode) => INLINE.has(node.type);

/** A whole block, unchanged or added or removed with everything in it. */
function plain(node: HistoryNode, change: BlockChange, key: string, top: boolean): ReactNode {
  const content = node.content ?? [];
  const children: ReactNode[] = [];
  // Screen readers hear the change once per block of text, never inside a list or a table row.
  if ((change === 'added' || change === 'removed') && content.every(isInline)) {
    children.push(<Marker key="marker" change={change} />);
  }
  content.forEach((child, index) => {
    const childKey = `${key}-${index}`;
    children.push(
      isInline(child) ? inline(child, childKey) : plain(child, change, childKey, false),
    );
  });
  return element(node, top ? CHANGE_CLASSES[change] : '', children, key);
}

function block(diff: DiffBlock, key: string): ReactNode {
  const { change, node } = diff;
  if (diff.pieces) {
    const children = pieces(diff.pieces, key);
    return element(node, CHANGE_CLASSES.changed, children, key);
  }
  if (diff.blocks) {
    // The bar goes on the blocks inside that changed; on the block itself if none did.
    const inner = diff.blocks;
    const className = inner.every((one) => one.change === 'same') ? CHANGE_CLASSES.changed : '';
    const children = inner.map((one, index) => block(one, `${key}-${index}`));
    return element(node, className, children, key);
  }
  return plain(node, change, key, true);
}

/** The title, with its changes marked when Show changes is on. */
function title(page: PreviewPage, previous: PreviewPage | null, showChanges: boolean) {
  const text = (value: string): HistoryNode[] => (value ? [{ type: 'text', text: value }] : []);
  if (!showChanges || !previous || previous.title === page.title) return page.title || 'Untitled';
  return pieces(diffText(text(previous.title), text(page.title)), 'title');
}

export function VersionPreview({ page, previous, showChanges, className }: VersionPreviewProps) {
  const blocks = useMemo(
    () => diffDocs(showChanges ? (previous?.content ?? null) : null, page.content),
    [page.content, previous?.content, showChanges],
  );
  return (
    <article className={cn('flex flex-col gap-2 text-body text-fg', className)}>
      <h1 className="text-title">{title(page, previous, showChanges)}</h1>
      {blocks.length === 0 ? (
        <p className="text-muted">This version is empty.</p>
      ) : (
        blocks.map((one, index) => block(one, `block-${index}`))
      )}
    </article>
  );
}
