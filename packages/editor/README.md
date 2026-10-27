# @carehub/editor

The Care Hub page editor: Tiptap 3 (open-source extensions only) on Yjs.

```tsx
import { BlockEditor } from '@carehub/editor';

<BlockEditor ydoc={ydoc} provider={provider} user={{ id, name, color }} editable={canEdit} />;
```

- Works on a local `Y.Doc` alone. Give the collab provider of the same doc (Hocuspocus or
  y-websocket; anything with `awareness`) and the `user` to show carets and selections with names.
- `BlockEditor` imports its own content styles, built on the `@carehub/ui` tokens for colors,
  sizes and type (`--ch-*`).
- `@carehub/editor/schema` has the page schema with no UI (no DOM, no React) for the server,
  and `sanitizeRichText` for rich text field values.

## Props

| Prop          | Default            | Notes                                                          |
| ------------- | ------------------ | -------------------------------------------------------------- |
| `ydoc`        | required           | The page's `Y.Doc`.                                            |
| `field`       | `'default'`        | XML fragment in `ydoc` that holds the blocks (`PAGE_FIELD`).   |
| `provider`    | `null`             | `{ awareness }`; a new provider makes a new editor.            |
| `user`        |                    | `{ id?, name, color }`; `color` is a CSS color for your caret. |
| `editable`    | `true`             | `false` makes it read-only.                                    |
| `placeholder` | `Type '/' for ...` | Shown in an empty page.                                        |
| `ariaLabel`   | `'Page content'`   | Accessible name of the editing area (read on mount).           |
| `onReady`     |                    | Gets the Tiptap `Editor` once it exists.                       |
| `nodeViews`   | `{}`               | React views of lane blocks by node name (read on creation).    |
| `slashItems`  | `[]`               | More "/" menu entries (`SlashItem`); can change at any time.   |
| `linkPickers` | `[]`               | More link targets in the link panel (`LinkPicker`).            |
| `bubbleItems` | `[]`               | More selection toolbar buttons (`BubbleItem`).                 |
| `extensions`  | `[]`               | Shortcuts and plugins, not nodes or marks (read on creation).  |

## Block groups

The core block catalog lives in `src/blocks/`, one file per block group (`text`, `lists`, `toggle`,
`callout`, `colors`, `code`, `table`, `columns`, `tabs`, `math`, `toc`, `synced`, `page`, `media`,
`embed`), each `export const nodes: AnyExtension[]`. Each group owns only its file; core owns
`blocks/index.ts` and `schema.ts`. The files hold schema only (nodes, marks, attributes, typing
rules and shortcuts from `@tiptap` packages, never React), because the server loads them too.

A group's "/" menu entries and React views go next to it in `blocks/<group>.ui.ts` (`.tsx` once it
has JSX): `export const slashItems: SlashItem[]` and `export const nodeViews: NodeViews`. Core owns
`blocks/ui.ts`, which collects them; within a menu group, entries keep its order of groups.
`blockItem()` in `blocks/item.ui.ts` makes an entry that turns the current line into a block.

## The "/" menu

Type "/" at the start of a line or after a space. The menu filters by title and keywords as you
type (spaces allowed), moves with the arrow keys, runs the active entry on Enter, and closes on
Escape (for that "/") or after three characters that match nothing. Nothing typed yet: the last
five blocks you used come first under "Suggested" (kept per `user.id` in `localStorage`). The
menu stays on screen on a phone, above the on-screen keyboard (it reads `visualViewport`).

Groups are listed in the spec's order, "Suggested", "Basic blocks", "Media", "Database",
"Advanced", "Inline", "Embeds", then any other group, and "Actions" last. Lanes add entries through
`slashItems`:

```tsx
const shiftNote: SlashItem = {
  id: 'shiftNote',
  title: 'Shift note',
  description: 'Handover for the next shift',
  group: 'Advanced',
  keywords: ['handover'],
  icon: <NotebookPen size={18} />,
  run: (editor) => editor.chain().focus().insertContent({ type: 'shiftNote' }).run(),
};
<BlockEditor ydoc={ydoc} slashItems={[shiftNote]} />;
```

`run` gets the editor once the typed "/query" is gone. `hint` shows a Markdown shortcut on the
right, like `#` or `---`.

## The selection toolbar

Selecting text (outside code) shows a toolbar above it: Bold, Italic, Underline, Strikethrough,
Inline code and Link, then any `bubbleItems`. It's a `toolbar` with arrow-key movement; Alt+F10
moves focus into it and Escape goes back to the text. The link panel takes a web or email address
(`example.com` becomes `https://example.com`, `robin@example.com` becomes `mailto:`), shows a
message for anything else, and lists the `linkPickers`:

```tsx
const lessonPicker: LinkPicker = {
  label: 'Link to a lesson',
  pick: () => openLessonDialog(), // resolves to '/learning/lessons/<id>', or null
};
<BlockEditor ydoc={ydoc} linkPickers={[lessonPicker]} />;
```

Links from the panel or a picker go through `safeHref` and open like every other link: other
sites in a new tab; Care Hub (like `/p/<pageId>`), `mailto` and `tel` links in the same tab. An
address starting with `//` becomes `https://`, and an unsafe href from a picker is ignored.

## RichTextField

A small rich text input for forms and properties, without live co-editing: paragraphs, hard
breaks (Shift+Enter) and the marks you allow, with the same selection toolbar.

```tsx
import { RichTextField, type JSONContent } from '@carehub/editor';

const [description, setDescription] = useState<JSONContent>({ type: 'doc', content: [] });
<RichTextField
  value={description}
  onChange={setDescription}
  ariaLabel="Lesson description"
  marks={['bold', 'italic', 'link']}
  onPickPage={pickPage} // adds "Link to a page", which links to /p/<pageId>
/>;
```

- `value` is Tiptap JSON. Whatever it holds, the field shows (and `onChange` sends) only
  paragraphs of text and hard breaks with the allowed marks and safe links; anything nested more
  than 64 levels deep is dropped. `sanitizeRichText` does the same cleanup, for example on the
  server before saving (from `@carehub/editor/schema` there).
- A link keeps only its `href`, through `safeHref` (`//host` becomes `https://host`). Where it
  opens comes from the href when it's drawn, as in the page editor.
- `singleLine`: Enter adds nothing, and pasted or dropped lines join with spaces.
- `ariaLabel` names the text box, so make it match the visible label: a `<label htmlFor>` doesn't
  name or focus a contenteditable. `id` goes on the text box, as a target for other elements'
  `aria-labelledby` or `aria-describedby`; `ariaDescribedBy` points to a hint.
- Also `placeholder` (also given as `aria-placeholder`), `autoFocus`, `readOnly` and
  `linkPickers`. With no `marks`, selecting text shows no toolbar. Changing `marks` or
  `singleLine` makes a new editor.

## Lane blocks and extension points (shared contract, see docs/decisions/0007)

- **Lane nodes** go in `src/lanes/<lane>.ts` (`export const nodes: AnyExtension[]`). Each lane owns
  its file; core owns `lanes/index.ts`. They are schema only: `Node.create` (or `Mark.create`) with
  name, attributes, group, atom or content, `parseHTML` and `renderHTML`, importing only from
  `@tiptap/core` or `@tiptap/pm` (a test checks this). `pageExtensions()` and `createPageSchema()`
  always include them, so the server and every client know every block.
- **`nodeViews`**: the React view of a node, by name, from the web `editor` slot. A lane block
  without a view shows a plain box ("This block needs Databases.") and is kept.
- **`extensions`**: only behavior, like shortcuts or plugins. Nodes and marks there are ignored with
  a console warning: when y-prosemirror meets a node it doesn't know, it removes it from the shared
  `Y.Doc`, so a block that only some clients know would be deleted for everyone.
- **`slashItems`** (`SlashItem`): more "/" menu entries, see above.
- **`linkPickers`** (`LinkPicker`) and **`bubbleItems`** (`BubbleItem`): more link targets and
  toolbar buttons, see below.

```tsx
// packages/editor/src/lanes/databases.ts: schema only
export const nodes: AnyExtension[] = [
  Node.create({
    name: 'database',
    group: 'block',
    atom: true,
    addAttributes: () => ({ databaseId: { default: null } }),
    parseHTML: () => [{ tag: 'div[data-database]' }],
    renderHTML: ({ HTMLAttributes }) => ['div', { 'data-database': '', ...HTMLAttributes }],
  }),
];

// apps/web, through the editor slot: the view
const DatabaseView = ({ node }: ReactNodeViewProps) => (
  <NodeViewWrapper>{/* the inline database for node.attrs.databaseId */}</NodeViewWrapper>
);
<BlockEditor ydoc={ydoc} nodeViews={{ database: DatabaseView }} />;
```

## Document format

- The blocks live in the `Y.Doc` XML fragment `default`.
- Nodes: `doc`, `paragraph`, `hardBreak`, `text` (core); `heading` (`level` 1-3, drawn as `<h2>`
  to `<h4>` with `data-level`, because the page title is the `<h1>`) in `text`; `bulletList`,
  `orderedList` (`start`; `type`: `1`, `a`, `i`, or null to follow the depth), `listItem`,
  `taskList`, `taskItem` (`checked`) in `lists`;
  `blockquote` and `horizontalRule` in `callout`; `codeBlock` (`language`) in `code`; plus the
  lane nodes.
- Marks: `bold`, `italic`, `underline`, `strike`, `code`, `link` (`href`, `target`, `rel`).
- Links keep only `http`, `https`, `mailto`, `tel` and relative hrefs (like `/p/<pageId>`); other
  schemes are dropped when typed, pasted or loaded from HTML, and never drawn as an href, even when
  another client sends one. A href starting with `//` goes to another site, so it is only kept as
  `https://...`. `safeHref(href)` gives the href to use, or null. It trims spaces and invisible
  characters (like U+00A0 and U+200B) and reads the scheme without them.
- Where a link opens comes from its href each time it is drawn, never from a stored or pasted
  `target` or `rel`: other sites open in a new tab with `rel="noopener noreferrer"`; Care Hub,
  `mailto` and `tel` links open in the same tab.
- Names are part of the stored data: never rename or remove a node, mark or attribute once it is
  on main; only add new ones.

## Keyboard

- Markdown shortcuts at the start of a block, then a space: `#`, `##`, `###`, `-`, `*` or `+`,
  `1.`, `a.` (letters), `i.` (Roman numerals) and `"` (quote). Without a space: `[]` (to-do),
  `---` (divider) and three backticks (code). Also `**bold**`, `*italic*` and `` `code` ``. `>`
  makes a quote until the toggle list lands; `$$` comes with the math group.
- Ctrl/Cmd + B, I, U, Shift+S (strike), E (code). Ctrl/Cmd + Z right after a shortcut turns it
  back into what you typed; otherwise it undoes only your own changes (Yjs undo). Shift+Z or Y
  redoes. Tab and Shift+Tab indent and outdent list items.
- Ctrl/Cmd + K edits the link of the selected text (or of the link the cursor is in). Anywhere
  else it's left to the app's command menu, which should skip key events already
  `defaultPrevented`. Alt+F10 moves focus into the selection toolbar.
