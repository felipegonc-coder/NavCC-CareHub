import type { ChainedCommands } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
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

/** Selected text (not a whole block, not in code) while the editor or the toolbar has focus. */
const shouldShow: ShouldShow = ({ editor, view, state, from, to }) => {
  const { selection } = state;
  if (!editor.isEditable || selection.empty || selection instanceof NodeSelection) return false;
  if (editor.isActive('codeBlock') || !state.doc.textBetween(from, to, ' ').trim()) return false;
  return view.hasFocus() || !!document.activeElement?.closest('[data-ch-toolbar]');
};

export interface FormattingToolbarProps {
  editor: Editor;
  /** More ways to choose a link target, shown in the link panel. */
  linkPickers?: LinkPicker[];
  /** More buttons, after the formatting ones. */
  bubbleItems?: BubbleItem[];
}

/** The formatting toolbar, floating above selected text. */
export function SelectionToolbar(props: FormattingToolbarProps) {
  return (
    <BubbleMenu editor={props.editor} shouldShow={shouldShow} className="ch-bubble">
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

/** Buttons for the marks the editor's schema has, the link panel and any extra buttons. */
export function FormattingToolbar({
  editor,
  linkPickers = [],
  bubbleItems = [],
}: FormattingToolbarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [linkAt, setLinkAt] = useState<string | null>(null);
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      at: `${e.state.selection.from}:${e.state.selection.to}`,
      active: Object.fromEntries(MARK_BUTTONS.map((b) => [b.mark, e.isActive(b.mark)])),
      link: e.isActive('link') ? String(e.getAttributes('link').href ?? '') : null,
      extra: bubbleItems.map((item) => item.isActive?.(e) ?? false),
    }),
  });
  // The link panel belongs to the selection it was opened for.
  const linkOpen = linkAt !== null && linkAt === state.at;

  const openLink = useCallback(() => {
    const { from, to } = editor.state.selection;
    setLinkAt(`${from}:${to}`);
  }, [editor]);
  const done = () => setLinkAt(null);

  useEffect(
    () =>
      registerToolbar(editor, {
        openLink,
        focus: () => ref.current?.querySelector<HTMLElement>('button, input')?.focus(),
      }),
    [editor, openLink],
  );

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

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Text formatting"
      data-ch-toolbar=""
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="ch-toolbar"
    >
      {linkOpen ? (
        <LinkForm editor={editor} href={state.link ?? ''} pickers={linkPickers} onDone={done} />
      ) : (
        <>
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
          {has('link') && (
            <ToolButton
              label={state.link === null ? 'Add link' : 'Edit link'}
              title={`Link (${shortcut('K')})`}
              onClick={openLink}
            >
              <Link size={16} aria-hidden="true" />
            </ToolButton>
          )}
          {bubbleItems.map((item, index) => (
            <ToolButton
              key={item.id}
              label={item.label}
              pressed={item.isActive ? state.extra[index] === true : undefined}
              onClick={() => item.run(editor)}
            >
              {item.icon ?? item.label}
            </ToolButton>
          ))}
        </>
      )}
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
