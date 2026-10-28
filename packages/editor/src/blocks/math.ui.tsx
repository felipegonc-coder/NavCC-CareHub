import type { Editor, EditorEvents } from '@tiptap/core';
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Radical, Sigma } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from 'react';
import 'katex/dist/katex.min.css';
import type { BubbleItem, NodeViews, SlashItem } from '../types';
import { insertBlockMath, MATH_EDIT, toInlineMath } from './math';
import './math.css';

type Katex = (typeof import('katex'))['default'];

let katex: Katex | null = null;
let katexLoad: Promise<Katex> | null = null;

/** Loads KaTeX the first time an equation shows (it's big, and most pages have none). */
export function loadKatex(): Promise<Katex> {
  if (!katexLoad) {
    const load = import('katex').then((module) => (katex = module.default));
    // A failed download is tried again by the next equation.
    load.catch(() => {
      if (katexLoad === load) katexLoad = null;
    });
    katexLoad = load;
  }
  return katexLoad;
}

/**
 * Draws TeX into `element` with KaTeX. Untrusted input: no links, pictures or styles from the TeX
 * (`trust: false`). Returns false for TeX that KaTeX can't read.
 */
function drawMath(element: HTMLElement, latex: string, displayMode: boolean): boolean {
  if (!katex) return false;
  try {
    katex.render(latex, element, {
      displayMode,
      throwOnError: true,
      trust: false,
      strict: 'ignore',
    });
    return true;
  } catch {
    element.textContent = '';
    return false;
  }
}

/**
 * An equation as KaTeX draws it. Until KaTeX has loaded it shows the TeX; TeX that doesn't draw
 * shows "Invalid equation" (spec 3.4), and the TeX is kept.
 */
function MathRender({ latex, display }: { latex: string; display: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState(katex !== null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (loaded) return;
    let live = true;
    loadKatex().then(
      () => {
        if (live) setLoaded(true);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [loaded]);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element && loaded) setInvalid(!drawMath(element, latex, display));
  }, [latex, display, loaded]);

  if (!latex) return <span className="ch-math-empty">Empty equation</span>;
  return (
    <>
      <span ref={ref} className="ch-math-render" hidden={!loaded || invalid} />
      {loaded ? null : <span className="ch-math-source">{latex}</span>}
      {loaded && invalid ? <span className="ch-math-error">Invalid equation</span> : null}
    </>
  );
}

/**
 * Whether the equation editor is open. It opens for a new empty equation once it's selected,
 * and when Enter (or Ctrl+Shift+E) asks for it through a MATH_EDIT transaction.
 */
function useEditing(
  editor: Editor,
  getPos: () => number | undefined,
  selected: boolean,
  latex: string,
): [boolean, Dispatch<SetStateAction<boolean>>] {
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (selected && editable && latex === '') setEditing(true);
  }, [selected, editable, latex]);

  useEffect(() => {
    const open = ({ transaction }: EditorEvents['transaction']) => {
      if (transaction.getMeta(MATH_EDIT) === getPos()) setEditing(true);
    };
    editor.on('transaction', open);
    return () => {
      editor.off('transaction', open);
    };
  }, [editor, getPos]);

  return [editable && editing, setEditing];
}

/** The TeX being typed: shown at once, while each change also goes to the page (live preview). */
function useDraft(latex: string, editing: boolean, save: (latex: string) => void) {
  const [draft, setDraft] = useState(latex);
  useEffect(() => {
    if (!editing) setDraft(latex);
  }, [editing, latex]);
  const change = (value: string) => {
    setDraft(value);
    save(value);
  };
  return [draft, change] as const;
}

const latexOf = (node: ReactNodeViewProps['node']) =>
  typeof node.attrs.latex === 'string' ? node.attrs.latex : '';

/** Ctrl+Enter or Esc closes the equation editor (Enter too, for an inline equation). */
function closesEditor(event: KeyboardEvent, inline: boolean): boolean {
  if (event.key === 'Escape') return true;
  return event.key === 'Enter' && (inline || event.ctrlKey || event.metaKey);
}

/** Puts the caret at the end of the TeX when the editor opens. */
function focusAtEnd(element: HTMLInputElement | HTMLTextAreaElement | null) {
  if (!element) return;
  element.focus();
  element.setSelectionRange(element.value.length, element.value.length);
}

/** A block equation: click (or Enter when selected) to edit the TeX, with the drawing above it. */
function BlockMathView({ node, editor, getPos, selected, updateAttributes }: ReactNodeViewProps) {
  const latex = latexOf(node);
  const [editing, setEditing] = useEditing(editor, getPos, selected, latex);
  const [draft, change] = useDraft(latex, editing, (value) => updateAttributes({ latex: value }));
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) focusAtEnd(inputRef.current);
  }, [editing]);

  const close = () => {
    setEditing(false);
    const pos = getPos();
    if (typeof pos === 'number') editor.chain().focus().setNodeSelection(pos).run();
  };

  return (
    <NodeViewWrapper className="ch-math-block" data-editing={editing ? '' : undefined}>
      {editor.isEditable && !editing ? (
        <button type="button" className="ch-math-view" onClick={() => setEditing(true)}>
          <MathRender latex={latex} display />
        </button>
      ) : (
        <div className="ch-math-view">
          <MathRender latex={latex} display />
        </div>
      )}
      {editing ? (
        <div className="ch-math-editor">
          <textarea
            ref={inputRef}
            className="ch-math-input"
            aria-label="Equation"
            placeholder="TeX, like E = mc^2"
            spellCheck={false}
            rows={Math.min(8, Math.max(2, draft.split('\n').length))}
            value={draft}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if (!closesEditor(event, false)) return;
              event.preventDefault();
              event.stopPropagation();
              close();
            }}
            onBlur={() => setEditing(false)}
          />
          <button
            type="button"
            className="ch-math-done"
            onMouseDown={(event) => event.preventDefault()}
            onClick={close}
          >
            Done
          </button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

/** An inline equation: click (or Enter when selected) to edit its TeX in a small box below it. */
function InlineMathView({ node, editor, getPos, selected, updateAttributes }: ReactNodeViewProps) {
  const latex = latexOf(node);
  const [editing, setEditing] = useEditing(editor, getPos, selected, latex);
  const [draft, change] = useDraft(latex, editing, (value) => updateAttributes({ latex: value }));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) focusAtEnd(inputRef.current);
  }, [editing]);

  const close = () => {
    setEditing(false);
    const pos = getPos();
    if (typeof pos === 'number') {
      editor
        .chain()
        .focus()
        .setTextSelection(pos + node.nodeSize)
        .run();
    }
  };

  return (
    <NodeViewWrapper as="span" className="ch-math-inline" data-editing={editing ? '' : undefined}>
      {editor.isEditable && !editing ? (
        <button type="button" className="ch-math-view" onClick={() => setEditing(true)}>
          <MathRender latex={latex} display={false} />
        </button>
      ) : (
        <span className="ch-math-view">
          <MathRender latex={latex} display={false} />
        </span>
      )}
      {editing ? (
        <span className="ch-math-popover">
          <input
            ref={inputRef}
            className="ch-math-input"
            aria-label="Equation"
            placeholder="TeX, like x^2"
            spellCheck={false}
            value={draft}
            onChange={(event) => change(event.target.value)}
            onKeyDown={(event) => {
              if (!closesEditor(event, true)) return;
              event.preventDefault();
              event.stopPropagation();
              close();
            }}
            onBlur={() => setEditing(false)}
          />
          <button
            type="button"
            className="ch-math-done"
            onMouseDown={(event) => event.preventDefault()}
            onClick={close}
          >
            Done
          </button>
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}

const keywords = ['equation', 'math', 'formula', 'tex', 'latex', 'katex'];

export const slashItems: SlashItem[] = [
  {
    id: 'blockMath',
    title: 'Block equation',
    description: 'A TeX equation on its own line',
    group: 'Advanced',
    keywords,
    hint: '$$',
    icon: <Sigma size={18} />,
    run: (editor) => {
      insertBlockMath(editor);
    },
  },
  {
    id: 'inlineMath',
    title: 'Inline equation',
    description: 'A TeX equation in the line of text',
    group: 'Inline',
    keywords,
    icon: <Radical size={18} />,
    run: (editor) => {
      toInlineMath(editor);
    },
  },
];

/**
 * The selection toolbar's Equation button (spec 3.5): turns the selected text into an inline
 * equation. Core's blocks/ui.ts doesn't collect group toolbar buttons yet.
 */
export const bubbleItems: BubbleItem[] = [
  {
    id: 'equation',
    label: 'Equation',
    icon: <Sigma size={16} aria-hidden="true" />,
    isActive: (editor) => editor.isActive('inlineMath'),
    run: (editor) => {
      toInlineMath(editor);
    },
  },
];

export const nodeViews: NodeViews = { blockMath: BlockMathView, inlineMath: InlineMathView };
