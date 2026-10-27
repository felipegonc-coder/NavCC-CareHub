import { previewBlocks, type PreviewBlock } from '@carehub/extras/templates/preview';
import { VisuallyHidden } from '@carehub/ui';
import { useMemo } from 'react';

/** Names for blocks the preview can't draw, such as a button or a database. */
const BLOCK_NAMES: Record<string, string> = {
  actionButton: 'Button',
  database: 'Database',
  image: 'Picture',
  file: 'File',
  video: 'Video',
  embed: 'Embed',
  callout: 'Callout',
  toggle: 'Toggle list',
  table: 'Table',
  columns: 'Columns',
};

function Item({
  block,
  number,
}: {
  block: Extract<PreviewBlock, { type: 'item' }>;
  number: number;
}) {
  const marker =
    block.checked !== undefined ? (block.checked ? '☑' : '☐') : block.ordered ? `${number}.` : '•';
  return (
    <div className="flex gap-2" style={{ paddingLeft: `${block.depth * 1.5}rem` }}>
      <span aria-hidden className="w-5 shrink-0 text-muted">
        {marker}
      </span>
      {block.checked !== undefined && (
        <VisuallyHidden>{block.checked ? 'Done: ' : 'To do: '}</VisuallyHidden>
      )}
      <span className={block.checked ? 'text-muted line-through' : undefined}>
        {block.text || '\u00a0'}
      </span>
    </div>
  );
}

/** A read-only reading of a template's top page, for the gallery preview. */
export function PreviewPage({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => previewBlocks(markdown), [markdown]);
  if (blocks.length === 0) return <p className="text-small text-muted">This page is empty.</p>;
  const numbers: number[] = [];
  return (
    <div className="flex flex-col gap-2 text-body text-fg">
      {blocks.map((block, index) => {
        const key = `${index}-${block.type}`;
        if (block.type !== 'item') numbers.length = 0;
        switch (block.type) {
          case 'heading': {
            const Heading = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5';
            const size =
              block.level === 1 ? 'text-h2' : block.level === 2 ? 'text-h3' : 'text-body';
            return (
              <Heading key={key} className={`${size} mt-2 font-semibold`}>
                {block.text}
              </Heading>
            );
          }
          case 'item': {
            // Numbered items count up at their depth; anything else at that depth starts again.
            const number = block.ordered ? (numbers[block.depth] ?? 0) + 1 : 0;
            numbers[block.depth] = number;
            numbers.length = block.depth + 1;
            return <Item key={key} block={block} number={number} />;
          }
          case 'quote':
            return (
              <blockquote key={key} className="border-l-2 border-border pl-3 text-muted">
                {block.text}
              </blockquote>
            );
          case 'code':
            return (
              <pre key={key} className="overflow-x-auto rounded bg-fill p-3 text-small">
                <code>{block.text}</code>
              </pre>
            );
          case 'divider':
            return <hr key={key} className="border-border" />;
          case 'block':
            return (
              <p
                key={key}
                className="rounded border border-dashed border-border px-3 py-2 text-small text-muted"
              >
                {BLOCK_NAMES[block.node] ?? 'Block'}
              </p>
            );
          default:
            return <p key={key}>{block.text}</p>;
        }
      })}
    </div>
  );
}
