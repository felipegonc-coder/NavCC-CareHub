import { pasteToBlocks } from '@carehub/learning';
import type { Block } from '@carehub/learning';
import { Button, Field, Textarea } from '@carehub/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { blocksSummary } from '../labels';

/**
 * "Paste text" in the add-block menu: pasted text or simple Markdown becomes tidy blocks (`pasteToBlocks`). It says
 * what it will make before anything is added.
 */
export function PasteForm({ onAdd, onBack }: { onAdd(blocks: Block[]): void; onBack(): void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => box.current?.focus(), []);
  const [text, setText] = useState('');
  const blocks = useMemo(() => pasteToBlocks(text), [text]);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (blocks.length > 0) onAdd(blocks);
      }}
    >
      <Field
        label="Text to turn into blocks"
        hint="Headings (#), lists (- or 1.), quotes (>), notes (Note:), dividers (---) and tables each become a block."
      >
        <Textarea
          ref={box}
          rows={8}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <p role="status" className="text-small text-muted">
        {blocks.length > 0 ? `Makes ${blocksSummary(blocks)}.` : 'Paste or type some text first.'}
      </p>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={blocks.length === 0}>
          {blocks.length === 0 ? 'Add blocks' : `Add ${blocksSummary(blocks).split(':')[0]}`}
        </Button>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </form>
  );
}
