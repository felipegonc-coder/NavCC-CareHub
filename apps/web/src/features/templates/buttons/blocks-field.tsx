// The blocks an Insert blocks step adds, edited like a page: the same blocks and "/" menu, plus
// the variables Today, Now, Me and This page as purple chips (spec 3.3).
import {
  BlockEditor,
  type Editor,
  type JSONContent,
  type NodeViews,
  type SlashItem,
} from '@carehub/editor';
import type { BlockJson } from '@carehub/extras/templates/buttons';
import { variableLabel, type TemplateVariable } from '@carehub/extras/templates/content';
import { Button } from '@carehub/ui';
import { AtSign } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as Y from 'yjs';
import { VariableChipView } from './variable-chip';

const VARIABLES: { kind: TemplateVariable; description: string }[] = [
  { kind: 'today', description: 'The date it’s pressed' },
  { kind: 'now', description: 'The date and time it’s pressed' },
  { kind: 'me', description: 'The person who pressed it' },
  { kind: 'this_page', description: 'A link to this page' },
];

const insertVariable = (editor: Editor, kind: TemplateVariable) =>
  editor
    .chain()
    .focus()
    .insertContent({ type: 'templateVariable', attrs: { kind, offsetDays: 0 } })
    .run();

const VARIABLE_ITEMS: SlashItem[] = VARIABLES.map(({ kind, description }) => ({
  id: `templates.variable.${kind}`,
  title: variableLabel(kind),
  description,
  icon: <AtSign size={18} />,
  keywords: ['variable'],
  group: 'Inline',
  run: (editor) => insertVariable(editor, kind),
}));

const NODE_VIEWS: NodeViews = { templateVariable: VariableChipView };

/** The editor's blocks, or none when it holds only an empty line. */
function blocksOf(editor: Editor): BlockJson[] {
  return editor.isEmpty ? [] : ((editor.getJSON().content ?? []) as BlockJson[]);
}

export interface BlocksFieldProps {
  /** The editing area's name, like "Blocks step 1 inserts". */
  label: string;
  blocks: BlockJson[];
  onChange(blocks: BlockJson[]): void;
}

export function BlocksField({ label, blocks, onChange }: BlocksFieldProps) {
  const ydoc = useMemo(() => new Y.Doc(), []);
  const editorRef = useRef<Editor | null>(null);
  const first = useRef(blocks);
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => () => ydoc.destroy(), [ydoc]);

  // The "/" menu is drawn in document.body, outside the settings dialog, which takes pointer
  // events away from everything outside itself; this gives them back to the menu.
  useEffect(() => {
    const allow = () => {
      for (const menu of document.querySelectorAll<HTMLElement>('body > .ch-slash-menu')) {
        menu.style.pointerEvents = 'auto';
      }
    };
    const observer = new MutationObserver(allow);
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, []);

  const onReady = useCallback((editor: Editor) => {
    editorRef.current = editor;
    // Yjs binds the editor to the doc on a 0 ms timer; the blocks go in after that.
    setTimeout(() => {
      if (editor.isDestroyed) return;
      if (first.current.length > 0) {
        editor.commands.setContent({ type: 'doc', content: first.current as JSONContent[] });
      }
      editor.on('update', () => latest.current(blocksOf(editor)));
    }, 0);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div role="group" aria-label="Variables" className="flex flex-wrap items-center gap-1">
        <span className="text-small text-muted">Variables:</span>
        {VARIABLES.map(({ kind, description }) => (
          <Button
            key={kind}
            variant="ghost"
            size="sm"
            title={description}
            className="text-purple-text"
            onClick={() => editorRef.current && insertVariable(editorRef.current, kind)}
          >
            @{variableLabel(kind)}
          </Button>
        ))}
      </div>
      <BlockEditor
        ydoc={ydoc}
        ariaLabel={label}
        placeholder="Type '/' for blocks. Pressing the button adds them."
        nodeViews={NODE_VIEWS}
        slashItems={VARIABLE_ITEMS}
        onReady={onReady}
        className="min-h-24 rounded border border-border px-3 py-2"
      />
    </div>
  );
}

/** Whether an element is in one of the editor's menus: the "/" menu or the selection toolbar. */
export function inEditorMenu(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.ch-slash-menu, .ch-bubble') !== null;
}
