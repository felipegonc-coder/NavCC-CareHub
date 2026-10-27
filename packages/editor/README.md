# @carehub/editor

The Care Hub page editor: Tiptap 3 (open-source extensions only) on Yjs.

```tsx
import { BlockEditor } from '@carehub/editor';

<BlockEditor ydoc={ydoc} provider={provider} user={{ id, name, color }} editable={canEdit} />;
```

- Works on a local `Y.Doc` alone. Give the collab provider of the same doc (Hocuspocus or
  y-websocket; anything with `awareness`) and the `user` to show carets and selections with names.
- `BlockEditor` imports its own content styles, built on the `@carehub/ui` color tokens.
- `@carehub/editor/schema` has the page schema with no UI (no DOM, no React) for the server.

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
| `extensions`  | `[]`               | Shortcuts and plugins, not nodes or marks (read on creation).  |

## Block groups

The core block catalog lives in `src/blocks/`, one file per block group (`text`, `lists`, `toggle`,
`callout`, `colors`, `code`, `table`, `columns`, `tabs`, `math`, `toc`, `synced`, `page`, `media`,
`embed`), each `export const nodes: AnyExtension[]`. Each group owns only its file; core owns
`blocks/index.ts` and `schema.ts`. The files hold schema only (nodes, marks, attributes, typing
rules and shortcuts from `@tiptap` packages, never React), because the server loads them too. The
"/" menu entries and React views of a group come with the "/" menu, in `blocks/<group>.ui.tsx`.

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
- **`slashItems`** (`SlashItem`), **`linkPickers`** (`LinkPicker`) and **`bubbleItems`**
  (`BubbleItem`): the types are exported now; the "/" menu and the selection toolbar that show
  them come in the next pull requests.

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
- Nodes: `doc`, `paragraph`, `hardBreak`, `text` (core); `heading` (`level` 1-3) in `text`;
  `bulletList`, `orderedList` (`start`), `listItem`, `taskList`, `taskItem` (`checked`) in `lists`;
  `blockquote` and `horizontalRule` in `callout`; `codeBlock` (`language`) in `code`; plus the
  lane nodes.
- Marks: `bold`, `italic`, `underline`, `strike`, `code`, `link` (`href`, `target`, `rel`).
- Links keep only `http`, `https`, `mailto`, `tel` and relative hrefs (like `/p/<pageId>`); other
  schemes are dropped when typed, pasted or loaded from HTML.
- Names are part of the stored data: never rename or remove a node, mark or attribute once it is
  on main; only add new ones.

## Keyboard

- Markdown shortcuts: `#`, `##`, `###`, `-`, `*` or `+`, `1.`, `---`, and `**bold**`, `*italic*`,
  `` `code` ``. The rest of the spec's shortcuts come with their block groups.
- Ctrl/Cmd + B, I, U, Shift+S (strike), E (code). Ctrl/Cmd + Z undoes only your own changes
  (Yjs undo); Shift+Z or Y redoes. Tab and Shift+Tab indent and outdent list items.
