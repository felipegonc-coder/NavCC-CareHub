import {
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { Baseline, Bold, Italic, Link, Underline } from 'lucide-react';
import type { Property, RichText, TextColor, TextMark } from '@carehub/databases';
import { isRichTextEmpty, normalizeRichText, plainText, richTextLength } from '@carehub/databases';
import { VALUE_MESSAGES, validateValue } from '@carehub/databases/values';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  buttonClasses,
  cn,
  colorClasses,
  colorNames,
  type ColorName,
} from '@carehub/ui';
import {
  drawRichText,
  isDrawnAs,
  readPastedHtml,
  readPastedText,
  readRichText,
  readSelection,
  writeSelection,
} from './rich-dom';
import {
  formatAt,
  formatted,
  hasMark,
  linkAround,
  sameRichText,
  setColor,
  setLink,
  sharedLink,
  sliceRichText,
  spliceRichText,
  toggleMark,
  type Format,
  type TextRange,
} from './rich-model';

type Kind = 'typing' | 'other';

interface Snapshot {
  value: RichText;
  range: TextRange;
}

const FORMAT_INPUTS: Record<string, TextMark> = {
  formatBold: 'bold',
  formatItalic: 'italic',
  formatUnderline: 'underline',
};

/** Edits the browser offers that descriptions don't support (lists, drops, other formatting). */
const REFUSED_INPUTS = new Set([
  'insertOrderedList',
  'insertUnorderedList',
  'insertHorizontalRule',
  'insertLink',
  'insertFromDrop',
  'deleteByDrag',
  'insertFromPasteAsQuotation',
]);

/** Typing groups into one undo step while the keys keep coming. */
const TYPING_PAUSE_MS = 1000;
const UNDO_STEPS = 100;

/**
 * One editor's text, selection and undo history. The page holds the text while someone types;
 * this reads it back after each change and redraws it after formatting, pasting and undoing.
 */
class Session {
  root: HTMLDivElement | null = null;
  value: RichText;
  maxLength: number;
  /** The selection as last seen inside the editor. */
  range: TextRange = { start: 0, end: 0 };
  /** Formatting picked with nothing selected, for the next text typed at the caret. */
  pending: Format | null = null;
  private composing = false;
  private before: TextRange | null = null;
  private undo: Snapshot[] = [];
  private redo: Snapshot[] = [];
  private last: { kind: Kind; at: number } = { kind: 'other', at: 0 };
  private readonly changed: () => void;

  constructor(value: RichText, maxLength: number, changed: () => void) {
    this.value = normalizeRichText(value);
    this.maxLength = maxLength;
    this.changed = changed;
  }

  attach(root: HTMLDivElement | null) {
    this.root = root;
    if (root) drawRichText(root, this.value);
  }

  get empty(): boolean {
    return isRichTextEmpty(this.value);
  }

  private focused(): boolean {
    return this.root !== null && this.root.ownerDocument.activeElement === this.root;
  }

  /** Draws the text again and, when the editor has focus, puts the selection back. */
  private draw(range: TextRange) {
    this.range = range;
    if (!this.root) return;
    drawRichText(this.root, this.value);
    if (this.focused()) writeSelection(this.root, range);
  }

  focus() {
    if (!this.root) return;
    this.root.focus({ preventScroll: true });
    writeSelection(this.root, this.range);
  }

  /** The selection now, or where it was when the editor lost focus. */
  selection(): TextRange {
    const live = this.root ? readSelection(this.root) : null;
    if (live) this.range = live;
    return this.range;
  }

  private room(range: TextRange): number {
    return this.maxLength - (richTextLength(this.value) - (range.end - range.start));
  }

  /** What text typed over the range looks like: the pending format or the text around it. */
  private formatFor(range: TextRange): Format {
    if (this.pending) return this.pending;
    return formatAt(this.value, range.start === range.end ? range.start : range.start + 1);
  }

  private record(kind: Kind, range: TextRange) {
    const now = Date.now();
    const joins = kind === 'typing' && this.last.kind === 'typing';
    const merge = joins && now - this.last.at < TYPING_PAUSE_MS;
    this.last = { kind, at: now };
    if (merge) return;
    this.undo.push({ value: this.value, range });
    if (this.undo.length > UNDO_STEPS) this.undo.shift();
    this.redo = [];
  }

  private apply(next: RichText, range: TextRange, kind: Kind, before: TextRange) {
    this.record(kind, before);
    this.value = next;
    this.pending = null;
    this.draw(range);
    this.changed();
  }

  /** Puts `insert` over the range, cut to the room left, with the caret after it. */
  replace(insert: RichText, kind: Kind = 'other', range: TextRange = this.selection()) {
    const fitted = sliceRichText(insert, 0, Math.max(0, this.room(range)));
    if (fitted.length === 0 && range.start === range.end) return;
    const caret = range.start + richTextLength(fitted);
    const next = spliceRichText(this.value, range.start, range.end, fitted);
    this.apply(next, { start: caret, end: caret }, kind, range);
  }

  type(text: string, kind: Kind) {
    const range = this.selection();
    const format = this.formatFor(range);
    this.replace([formatted(text, format)], kind, range);
    // The browser would start the new line without the formatting, so carry it on from here.
    if (text === '\n' && (format.marks.length > 0 || format.color)) {
      this.pending = format;
      this.changed();
    }
  }

  pressed(mark: TextMark): boolean {
    const { start, end } = this.range;
    if (start === end) return (this.pending ?? formatAt(this.value, start)).marks.includes(mark);
    return hasMark(this.value, start, end, mark);
  }

  toggle(mark: TextMark) {
    const range = this.selection();
    if (range.start === range.end) {
      const format = this.formatFor(range);
      const on = !format.marks.includes(mark);
      const marks = format.marks.filter((m) => m !== mark);
      this.pending = { ...format, marks: on ? [...marks, mark] : marks };
      this.changed();
      return;
    }
    this.apply(toggleMark(this.value, range.start, range.end, mark), range, 'other', range);
  }

  color(color: TextColor | undefined) {
    const range = this.selection();
    if (range.start === range.end) {
      const format = { ...this.formatFor(range) };
      delete format.color;
      if (color) format.color = color;
      this.pending = format;
      this.changed();
      return;
    }
    this.apply(setColor(this.value, range.start, range.end, color), range, 'other', range);
  }

  /** Where a link change applies: the selection, or the whole link the caret is in. */
  linkTarget(): { range: TextRange; link?: string } {
    const range = this.selection();
    if (range.start !== range.end) {
      const link = sharedLink(this.value, range.start, range.end);
      return link ? { range, link } : { range };
    }
    const around = linkAround(this.value, range.start);
    return around
      ? { range: { start: around.start, end: around.end }, link: around.link }
      : { range };
  }

  link(range: TextRange, link: string | undefined) {
    if (range.start === range.end) {
      if (link) this.replace([formatted(link, { ...this.formatFor(range), link })], 'other', range);
      return;
    }
    this.apply(setLink(this.value, range.start, range.end, link), range, 'other', range);
  }

  undoStep() {
    const snapshot = this.undo.pop();
    if (!snapshot) return;
    this.redo.push({ value: this.value, range: this.selection() });
    this.restore(snapshot);
  }

  redoStep() {
    const snapshot = this.redo.pop();
    if (!snapshot) return;
    this.undo.push({ value: this.value, range: this.selection() });
    this.restore(snapshot);
  }

  private restore(snapshot: Snapshot) {
    this.value = snapshot.value;
    this.pending = null;
    this.last = { kind: 'other', at: 0 };
    this.draw(snapshot.range);
    this.changed();
  }

  /** Pasted text replaces the selection; only the toolbar's formatting comes with it. */
  paste(data: Pick<DataTransfer, 'getData'> | null) {
    if (!data) return;
    const range = this.selection();
    const room = this.room(range);
    const html = data.getData('text/html');
    let insert = html ? readPastedHtml(html, room) : [];
    if (isRichTextEmpty(insert)) {
      const text = plainText(readPastedText(data.getData('text/plain')));
      insert = text ? [formatted(text, this.formatFor(range))] : [];
    }
    if (insert.length) this.replace(insert, 'other', range);
  }

  beforeInput(event: InputEvent) {
    const type = event.inputType;
    if (type === 'historyUndo' || type === 'historyRedo') {
      event.preventDefault();
      if (type === 'historyUndo') this.undoStep();
      else this.redoStep();
      return;
    }
    const mark = FORMAT_INPUTS[type];
    if (mark) {
      event.preventDefault();
      this.toggle(mark);
      return;
    }
    if (type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault();
      this.type('\n', 'other');
      return;
    }
    if (REFUSED_INPUTS.has(type) || type.startsWith('format')) {
      event.preventDefault();
      return;
    }
    const range = this.selection();
    this.before = range;
    const data = event.data ?? '';
    if (type === 'insertText' && !event.isComposing && data) {
      if (this.pending || data.length > this.room(range)) {
        event.preventDefault();
        this.type(data, 'typing');
      }
    }
  }

  compositionStart() {
    this.composing = true;
    this.record('other', this.selection());
  }

  compositionEnd() {
    this.composing = false;
    this.last = { kind: 'other', at: 0 };
    this.sync();
  }

  /** Reads the text back after the browser changed it, keeping it within maxLength. */
  sync() {
    if (!this.root) return;
    const read = readRichText(this.root);
    const range = readSelection(this.root) ?? this.range;
    if (this.composing) {
      this.value = read;
      this.range = range;
      this.changed();
      return;
    }
    let next = read;
    let caret = range;
    const over = richTextLength(next) - this.maxLength;
    if (over > 0) {
      const from = Math.max(0, range.end - over);
      next = spliceRichText(next, from, range.end, []);
      next = sliceRichText(next, 0, this.maxLength);
      caret = { start: from, end: from };
    }
    if (!sameRichText(next, this.value)) this.record('typing', this.before ?? range);
    this.before = null;
    this.value = next;
    if (over > 0 || !isDrawnAs(this.root, next)) this.draw(caret);
    else this.range = caret;
    this.changed();
  }

  selectionChanged() {
    const live = this.root ? readSelection(this.root) : null;
    if (!live || (live.start === this.range.start && live.end === this.range.end)) return;
    this.range = live;
    this.pending = null;
    this.changed();
  }

  /** Puts outside text in (a saved value that changed), keeping the caret where it can be. */
  setValue(value: RichText) {
    if (sameRichText(value, this.value)) return;
    this.value = normalizeRichText(value);
    this.undo = [];
    this.redo = [];
    this.pending = null;
    const length = richTextLength(this.value);
    this.draw({ start: Math.min(this.range.start, length), end: Math.min(this.range.end, length) });
    this.changed();
  }
}

const LINK_PROPERTY: Property = {
  id: 'link',
  name: 'Link',
  description: '',
  config: { type: 'url' },
  rowPage: 'always',
};

/** A typed web address as a link ("bluepine.example" gets "https://"), or null if it isn't one. */
function toLink(typed: string): string | null {
  const result = validateValue(LINK_PROPERTY, typed);
  return result.ok && typeof result.value === 'string' ? result.value : null;
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const shortcut = (key: string) => (MAC ? `⌘${key}` : `Ctrl+${key}`);

const KEY_MARKS: Record<string, TextMark> = { b: 'bold', i: 'italic', u: 'underline' };

const MARK_TOOLS: { mark: TextMark; label: string; key: string; icon: typeof Bold }[] = [
  { mark: 'bold', label: 'Bold', key: 'B', icon: Bold },
  { mark: 'italic', label: 'Italic', key: 'I', icon: Italic },
  { mark: 'underline', label: 'Underline', key: 'U', icon: Underline },
];

const COLORS = colorNames.filter(
  (name): name is Exclude<ColorName, 'default'> => name !== 'default',
);
const colorLabel = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

const TOOL_CLASSES = buttonClasses({ variant: 'ghost', size: 'sm', icon: true });

/** Keeps the editor's focus and selection when a toolbar button is pressed with the mouse. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

function Swatch({ name, background }: { name?: (typeof COLORS)[number]; background?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-5 items-center justify-center rounded border border-border text-small font-semibold',
        name && (background ? colorClasses[name].bg : colorClasses[name].text),
      )}
    >
      A
    </span>
  );
}

function LinkForm({
  id,
  initial,
  onApply,
  onRemove,
}: {
  id: string;
  initial: string | undefined;
  onApply(link: string): void;
  onRemove(): void;
}) {
  const [text, setText] = useState(initial ?? '');
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!text.trim() && initial) return onRemove();
        const link = toLink(text);
        if (link) onApply(link);
        else setInvalid(true);
      }}
    >
      <label htmlFor={`${id}-address`} className="text-small font-medium text-fg">
        Web address
      </label>
      <Input
        id={`${id}-address`}
        value={text}
        placeholder="https://"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-address-error` : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid && (
        <p id={`${id}-address-error`} className="text-small text-danger">
          {VALUE_MESSAGES.url}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {initial && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove link
          </Button>
        )}
        <Button type="submit" size="sm">
          Apply
        </Button>
      </div>
    </form>
  );
}

export interface RichTextFieldProps {
  id?: string;
  value: RichText;
  /** Called with the new text when focus leaves the field, if it changed. */
  onCommit(next: RichText): void;
  maxLength: number;
  placeholder?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  onKeyDown?(event: KeyboardEvent<HTMLDivElement>): void;
}

/**
 * A description box edited as it looks: bold, italic, underline, colours and links from the toolbar
 * under it (shown while the field has focus) or the usual shortcuts. Pasting keeps only that
 * formatting. Saves when focus leaves the field.
 */
export function RichTextField({
  id,
  value,
  onCommit,
  maxLength,
  placeholder,
  onKeyDown,
  ...aria
}: RichTextFieldProps) {
  const autoId = useId();
  const editorId = id ?? `${autoId}-editor`;
  const [, changed] = useReducer((n: number) => n + 1, 0);
  const [session] = useState(() => new Session(value, maxLength, changed));
  const [focused, setFocused] = useState(false);
  const [linkTarget, setLinkTarget] = useState<{ range: TextRange; link?: string } | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [tool, setTool] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    session.attach(root);
    const beforeInput = (event: Event) => session.beforeInput(event as InputEvent);
    const start = () => session.compositionStart();
    const end = () => session.compositionEnd();
    const selection = () => session.selectionChanged();
    const doc = root.ownerDocument;
    root.addEventListener('beforeinput', beforeInput);
    root.addEventListener('compositionstart', start);
    root.addEventListener('compositionend', end);
    doc.addEventListener('selectionchange', selection);
    return () => {
      root.removeEventListener('beforeinput', beforeInput);
      root.removeEventListener('compositionstart', start);
      root.removeEventListener('compositionend', end);
      doc.removeEventListener('selectionchange', selection);
      session.attach(null);
    };
  }, [session]);

  useEffect(() => {
    session.maxLength = maxLength;
  }, [session, maxLength]);

  useEffect(() => {
    session.setValue(value);
  }, [session, value]);

  const openLink = () => setLinkTarget(session.linkTarget());

  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (wrapperRef.current?.contains(event.relatedTarget as Node | null)) return;
    setFocused(false);
    if (!sameRichText(session.value, value)) onCommit(session.value);
  };

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && !event.shiftKey) {
      const mark = KEY_MARKS[key];
      if (mark || key === 'k' || key === 'z' || key === 'y') event.preventDefault();
      if (mark) return session.toggle(mark);
      if (key === 'k') return openLink();
      if (key === 'z') return session.undoStep();
      if (key === 'y') return session.redoStep();
    }
    if (mod && event.shiftKey && !event.altKey && key === 'z') {
      event.preventDefault();
      return session.redoStep();
    }
    if (event.key === 'Enter' && !mod && !event.altKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      return session.type('\n', 'other');
    }
    onKeyDown?.(event);
  };

  /** Arrow keys, Home and End move between the toolbar's buttons (one Tab stop for all). */
  const toolbarKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const tools = [...(toolbarRef.current?.querySelectorAll<HTMLElement>('[data-tool]') ?? [])];
    const at = tools.findIndex((el) => el === event.target);
    if (at < 0) return;
    if (event.key === 'Escape') {
      // Back to the text, where the person was.
      event.preventDefault();
      session.focus();
      return;
    }
    const moves: Record<string, number> = {
      ArrowRight: (at + 1) % tools.length,
      ArrowLeft: (at - 1 + tools.length) % tools.length,
      Home: 0,
      End: tools.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setTool(next);
    tools[next]?.focus();
  };

  const toolProps = (index: number) => ({
    'data-tool': true,
    tabIndex: tool === index ? 0 : -1,
    onFocus: () => setTool(index),
  });

  /** After a menu or the link box closes, back to the text (unless they clicked somewhere else). */
  const clickedOutside = useRef(false);
  const refocus = (event: Event) => {
    event.preventDefault();
    if (!clickedOutside.current) session.focus();
    clickedOutside.current = false;
  };

  return (
    <div
      ref={wrapperRef}
      className="flex flex-col gap-1"
      onFocus={() => setFocused(true)}
      onBlur={leave}
    >
      <div className="relative">
        <div
          ref={rootRef}
          id={editorId}
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder}
          {...aria}
          tabIndex={0}
          contentEditable
          className="block min-h-20 w-full whitespace-pre-wrap break-words rounded border border-border bg-bg px-3 py-2 text-small text-fg transition-colors hover:border-border-hover"
          onInput={() => session.sync()}
          onKeyDown={keyDown}
          onPaste={(event) => {
            event.preventDefault();
            session.paste(event.clipboardData);
          }}
          onDrop={(event) => event.preventDefault()}
        />
        {session.empty && placeholder && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-px px-3 py-2 text-small text-faint"
          >
            {placeholder}
          </span>
        )}
      </div>
      {(focused || linkTarget !== null || colorOpen) && (
        <div
          ref={toolbarRef}
          role="toolbar"
          aria-label="Formatting"
          aria-controls={editorId}
          className="flex items-center gap-1"
          onKeyDown={toolbarKeys}
        >
          {MARK_TOOLS.map(({ mark, label, key, icon: Icon }, index) => (
            <Tooltip key={mark} content={`${label} (${shortcut(key)})`}>
              <IconButton
                label={label}
                size="sm"
                aria-pressed={session.pressed(mark)}
                {...toolProps(index)}
                onMouseDown={keepFocus}
                onClick={() => session.toggle(mark)}
              >
                <Icon aria-hidden />
              </IconButton>
            </Tooltip>
          ))}
          <Popover
            open={linkTarget !== null}
            onOpenChange={(open) => (open ? openLink() : setLinkTarget(null))}
          >
            <Tooltip content={`Link (${shortcut('K')})`}>
              <PopoverTrigger
                aria-label="Link"
                className={TOOL_CLASSES}
                {...toolProps(3)}
                onMouseDown={keepFocus}
              >
                <Link aria-hidden />
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent
              align="start"
              onInteractOutside={() => {
                clickedOutside.current = true;
              }}
              onCloseAutoFocus={refocus}
            >
              {linkTarget && (
                <LinkForm
                  id={editorId}
                  initial={linkTarget.link}
                  onApply={(link) => {
                    session.link(linkTarget.range, link);
                    setLinkTarget(null);
                  }}
                  onRemove={() => {
                    session.link(linkTarget.range, undefined);
                    setLinkTarget(null);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
          <DropdownMenu open={colorOpen} onOpenChange={setColorOpen}>
            <Tooltip content="Color">
              <DropdownMenuTrigger aria-label="Color" className={TOOL_CLASSES} {...toolProps(4)}>
                <Baseline aria-hidden />
              </DropdownMenuTrigger>
            </Tooltip>
            <DropdownMenuContent align="start" onCloseAutoFocus={refocus}>
              <DropdownMenuLabel>Text color</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => session.color(undefined)}>
                <Swatch />
                Default
              </DropdownMenuItem>
              {COLORS.map((name) => (
                <DropdownMenuItem key={name} onSelect={() => session.color(name)}>
                  <Swatch name={name} />
                  {colorLabel(name)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Background</DropdownMenuLabel>
              {COLORS.map((name) => (
                <DropdownMenuItem
                  key={`${name}_background`}
                  onSelect={() => session.color(`${name}_background`)}
                >
                  <Swatch name={name} background />
                  {`${colorLabel(name)} background`}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
