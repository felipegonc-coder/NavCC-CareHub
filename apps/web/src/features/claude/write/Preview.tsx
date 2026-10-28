// Claude's answer as the result box shows it: the blocks Replace or Insert below will add, drawn
// with the kit's type and colours. Nothing here is HTML from Claude, only text in elements we
// choose. Links show as underlined words; they become links once the answer is in the page.
import type { ClaudeBlock, ClaudeInline, ClaudeText } from '@carehub/extras/claude/markdown';
import { VisuallyHidden } from '@carehub/ui';
import type { ReactNode } from 'react';

type Child = ClaudeBlock | ClaudeInline;

const isInline = (node: Child): node is ClaudeInline =>
  node.type === 'text' || node.type === 'hardBreak';

function Words({ node }: { node: ClaudeText }) {
  let words: ReactNode = node.text;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') words = <strong>{words}</strong>;
    else if (mark.type === 'italic') words = <em>{words}</em>;
    else if (mark.type === 'strike') words = <s>{words}</s>;
    else if (mark.type === 'code') {
      words = <code className="rounded-sm bg-fill px-1 font-mono">{words}</code>;
    } else words = <span className="underline">{words}</span>;
  }
  return <>{words}</>;
}

function Children({ nodes }: { nodes: readonly Child[] }) {
  return nodes.map((node, i) =>
    node.type === 'hardBreak' ? (
      <br key={i} />
    ) : node.type === 'text' ? (
      <Words key={i} node={node} />
    ) : (
      <Block key={i} block={node} />
    ),
  );
}

/** Page headings sit under the page title, so heading 1 to 3 are drawn as h2 to h4. */
const HEADINGS = {
  1: { Tag: 'h2', className: 'text-h3' },
  2: { Tag: 'h3', className: 'text-body font-semibold' },
  3: { Tag: 'h4', className: 'text-small font-semibold' },
} as const;

function Block({ block }: { block: ClaudeBlock }): ReactNode {
  const content = block.content ?? [];
  switch (block.type) {
    case 'paragraph':
      return (
        <p>
          <Children nodes={content} />
        </p>
      );
    case 'heading': {
      const level = block.attrs?.level;
      const { Tag, className } = HEADINGS[level === 2 || level === 3 ? level : 1];
      return (
        <Tag className={className}>
          <Children nodes={content} />
        </Tag>
      );
    }
    case 'bulletList':
      return (
        <ul className="flex list-disc flex-col gap-1 pl-6">
          <Children nodes={content} />
        </ul>
      );
    case 'orderedList': {
      const start = typeof block.attrs?.start === 'number' ? block.attrs.start : undefined;
      return (
        <ol start={start} className="flex list-decimal flex-col gap-1 pl-6">
          <Children nodes={content} />
        </ol>
      );
    }
    case 'listItem':
      return (
        <li>
          <Children nodes={content} />
        </li>
      );
    case 'taskList':
      return (
        <ul className="flex flex-col gap-1">
          <Children nodes={content} />
        </ul>
      );
    case 'taskItem': {
      const checked = block.attrs?.checked === true;
      return (
        <li className="flex gap-2">
          <span aria-hidden className="text-muted">
            {checked ? '☑' : '☐'}
          </span>
          <div className="min-w-0 flex-1">
            <VisuallyHidden>{checked ? 'Done: ' : 'To do: '}</VisuallyHidden>
            <Children nodes={content} />
          </div>
        </li>
      );
    }
    case 'blockquote':
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-border pl-3 text-muted">
          <Children nodes={content} />
        </blockquote>
      );
    case 'horizontalRule':
      return <hr className="border-border" />;
    case 'codeBlock':
      return (
        <pre className="whitespace-pre-wrap break-words rounded-sm bg-fill p-2 font-mono text-label">
          <code>
            {content.filter(isInline).map((node) => (node.type === 'text' ? node.text : '\n'))}
          </code>
        </pre>
      );
  }
}

/** The answer's blocks, in the result box. */
export function Preview({ blocks }: { blocks: readonly ClaudeBlock[] }) {
  return (
    <div className="flex flex-col gap-2 text-small text-fg">
      <Children nodes={blocks} />
    </div>
  );
}
