import type { ChainedCommands } from '@tiptap/core';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold,
  Code,
  Italic,
  Link,
  Strikethrough,
  Underline,
  Unlink,
  type LucideIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { linkAttributes, normalizeLinkInput, safeHref } from './links';
import { registerToolbar } from './toolbar-keys';
import type { BubbleItem, LinkPicker } from './types';

interface MarkButton {
  mark: string;
  label: string;
  keys: string;
  icon: LucideIcon;
  toggle: (chain: ChainedCommands) => ChainedCommands;
}

const MARK_BUTTONS: MarkButton[] = [
  { mark: 'bold', label: 'Bold', keys: 'B', icon: Bold, toggle: (c) => c.toggleBold() },
  { mark: 'italic', label: 'Italic', keys: 'I', icon: Italic, toggle: (c) => c.toggleItalic() },
  {
    mark: 'underline',
    label: 'Underline',
    keys: 'U',
    icon: Underline,
    toggle: (c) => c.toggleUnderline(),
  },
  {
    mark: 'strike',
    label: 'Strikethrough',
    keys: 'Shift+S',
    icon: Strikethrough,
    toggle: (c) => c.toggleStrike(),
  },
  { mark: 'code', label: 'Inline code', keys: 'E', icon: Code, toggle: (c) => c.toggleCode() },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const shortcut = (keys: string) => (isMac ? `⌘${keys.replace('Shift+', '⇧')}` : `Ctrl+${keys}`);

type ShouldShow = NonNullable<ComponentProps<typeof BubbleMenu>['shouldShow']>;

/** Whether the page's selection covers something and lies inside `dom`. */
function selectionIn(dom: HTMLElement): boolean {
  const selection = dom.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed) return false;
  return dom.contains(selection.anchorNode) && dom.contains(selection.focusNode);
}

/**
 * Selected text (not a whole block, not in code). While editing, the editor or the toolbar has
 * focus. A read-only editor can't take focus, so there the page's selection must be in it.
 */
function showFor(readOnly: boolean): ShouldShow {
  return ({ editor, view, state, from, to }) => {
    const { selection } = state;
    if (selection.empty || selection instanceof NodeSelection) return false;
    if (editor.isActive('codeBlock') || !state.doc.textBetween(from, to, ' ').trim()) return false;
    if (readOnly) return !editor.isEditable && selectionIn(view.dom);
    if (!editor.isEditable) return false;
    return view.hasFocus() || !!document.activeElement?.closest('[data-ch-toolbar]');
  };
}

export interface FormattingToolbarProps {
  editor: Editor;
  /** More ways to choose a link target, shown in the link panel. */
  linkPickers?: LinkPicker[];
  /** More buttons: `comment` right after Link, the others after the formatting buttons. */
  bubbleItems?: BubbleItem[];
  /** For a read-only editor: only the `readOnly` bubble items. */
  readOnly?: boolean;
}

/**
 * The formatting toolbar, floating above selected text. It reads `readOnly` once: remount it
 * (with a `key`) when that changes.
 */
export function SelectionToolbar(props: FormattingToolbarProps) {
  const { editor, readOnly = false } = props;
  const [shouldShow] = useState(() => showFor(readOnly));

  // Clicking outside a read-only editor leaves its selection behind (it never had focus to
  // lose). Drop it then, so the toolbar goes away.
  useEffect(() => {
    if (!readOnly) return;
    const { ownerDocument } = editor.view.dom;
    const onSelectionChange = () => {
      if (editor.isDestroyed) return;
      const { tr, selection } = editor.state;
      if (!(selection instanceof TextSelection) || selection.empty) return;
      if (selectionIn(editor.view.dom)) return;
      editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, selection.to)));
    };
    ownerDocument.addEventListener('selectionchange', onSelectionChange);
    return () => ownerDocument.removeEventListener('selectionchange', onSelectionChange);
  }, [editor, readOnly]);

  return (
    <BubbleMenu editor={editor} shouldShow={shouldShow} className="ch-bubble">
      <FormattingToolbar {...props} />
    </BubbleMenu>
  );
}

/**
 * Links the selected text to the href `picker` returns. The editor keeps its selection while the
 * picker is open (also through other people's edits), so the link lands on the same text.
 */
export async function pickLink(editor: Editor, picker: LinkPicker): Promise<boolean> {
  const href = safeHref(await picker.pick());
  if (href === null || editor.isDestroyed || editor.state.selection.empty) return false;
  return editor.chain().focus().extendMarkRange('link').setLink(linkAttributes(href)).run();
}

/**
 * In the spec's order: Link, Comment (the `comment` item), the marks the editor's schema has,
 * then the other items. Turn into, Equation, Color and "…" come with their block groups. In a
 * read-only editor, only the `readOnly` items.
 */
export function FormattingToolbar({
  editor,
  linkPickers = [],
  bubbleItems = [],
  readOnly = false,
}: FormattingToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [linkAt, setLinkAt] = useState<string | null>(null);
  const items = readOnly ? bubbleItems.filter((item) => item.readOnly) : bubbleItems;
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      at: `${e.state.selection.from}:${e.state.selection.to}`,
      active: Object.fromEntries(MARK_BUTTONS.map((b) => [b.mark, e.isActive(b.mark)])),
      link: e.isActive('link') ? String(e.getAttributes('link').href ?? '') : null,
      extra: Object.fromEntries(items.map((item) => [item.id, item.isActive?.(e) ?? false])),
    }),
  });
  // The link panel belongs to the selection it was opened for.
  const linkOpen = linkAt !== null && linkAt === state.at;

  const openLink = useCallback(() => {
    const { from, to } = editor.state.selection;
    setLinkAt(`${from}:${to}`);
  }, [editor]);
  const done = () => setLinkAt(null);

  useEffect(() => {
    if (readOnly) return;
    return registerToolbar(editor, {
      openLink,
      focus: () => ref.current?.querySelector<HTMLElement>('button, input')?.focus(),
    });
  }, [editor, openLink, readOnly]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setLinkAt(null);
      editor.commands.focus();
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.target instanceof HTMLInputElement) return;
    const buttons = Array.from(ref.current?.querySelectorAll('button') ?? []);
    const index = buttons.indexOf(event.target as HTMLButtonElement);
    if (index === -1) return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 1 : -1;
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };

  const has = (mark: string) => mark in editor.schema.marks;
  const comment = items.find((item) => item.id === 'comment');
  const itemButton = (item: BubbleItem) => (
    <ToolButton
      key={item.id}
      label={item.label}
      pressed={item.isActive ? state.extra[item.id] === true : undefined}
      onClick={() => item.run(editor)}
    >
      {item.icon ?? item.label}
    </ToolButton>
  );

  let content: ReactNode;
  if (readOnly) {
    content = items.map(itemButton);
  } else if (linkOpen) {
    content = (
      <LinkForm editor={editor} href={state.link ?? ''} pickers={linkPickers} onDone={done} />
    );
  } else {
    content = (
      <>
        {has('link') && (
          <ToolButton
            label={state.link === null ? 'Add link' : 'Edit link'}
            title={`Link (${shortcut('K')})`}
            onClick={openLink}
          >
            <Link size={16} aria-hidden="true" />
          </ToolButton>
        )}
        {comment && itemButton(comment)}
        {MARK_BUTTONS.filter((b) => has(b.mark)).map((b) => (
          <ToolButton
            key={b.mark}
            label={b.label}
            title={`${b.label} (${shortcut(b.keys)})`}
            pressed={state.active[b.mark] === true}
            onClick={() => b.toggle(editor.chain().focus()).run()}
          >
            <b.icon size={16} aria-hidden="true" />
          </ToolButton>
        ))}
        {items.filter((item) => item !== comment).map(itemButton)}
      </>
    );
  }

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={readOnly ? 'Selected text' : 'Text formatting'}
      data-ch-toolbar=""
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="ch-toolbar"
    >
      {content}
    </div>
  );
}

interface ToolButtonProps {
  label: string;
  title?: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({ label, title, pressed, onClick, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={pressed}
      className="ch-toolbar-button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface LinkFormProps {
  editor: Editor;
  href: string;
  pickers: LinkPicker[];
  onDone: () => void;
}

function LinkForm({ editor, href, pickers, onDone }: LinkFormProps) {
  const [value, setValue] = useState(href);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onDone();
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) {
      removeLink();
      return;
    }
    const url = normalizeLinkInput(value);
    if (!url) {
      setInvalid(true);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink(linkAttributes(url)).run();
    onDone();
  };

  return (
    <form className="ch-link-form" onSubmit={submit}>
      <div className="ch-link-row">
        <input
          ref={input}
          type="text"
          inputMode="url"
          aria-label="Link address"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          placeholder="Paste or type a link"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setInvalid(false);
          }}
          className="ch-link-input"
        />
        <button type="submit" className="ch-link-apply">
          Apply
        </button>
        {href && (
          <ToolButton label="Remove link" onClick={removeLink}>
            <Unlink size={16} aria-hidden="true" />
          </ToolButton>
        )}
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="ch-link-error">
          Enter a web address (like example.com) or an email address.
        </p>
      )}
      {pickers.map((picker) => (
        <button
          key={picker.label}
          type="button"
          className="ch-link-picker"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onDone();
            void pickLink(editor, picker);
          }}
        >
          {picker.label}
        </button>
      ))}
    </form>
  );
}
