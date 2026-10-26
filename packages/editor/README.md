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
| `extensions`  | `[]`               | More Tiptap nodes, marks and extensions (read on creation).    |

## Extension points (shared contract, see docs/decisions/0007)

- **`extensions`**: for example a `database` node with a React node view. Read when the editor is
  created; remount it (with a `key`) to change them.
- **`slashItems`** (`SlashItem`), **`linkPickers`** (`LinkPicker`) and **`bubbleItems`**
  (`BubbleItem`): the types are exported now; the "/" menu and the selection toolbar that show
  them come in the next pull requests.

**Every editor that opens a page must load the same extensions, and so must the server.** When
y-prosemirror meets a node it doesn't know, it removes it from the shared `Y.Doc`: one client
without the `database` extension would delete every database block for everyone. Register lane
blocks in one place and build the server's schema with `createPageSchema(laneExtensions)`.

## Document format

- The blocks live in the `Y.Doc` XML fragment `default`.
- Nodes: `doc`, `paragraph`, `heading` (`level` 1-3), `bulletList`, `orderedList` (`start`),
  `listItem`, `taskList`, `taskItem` (`checked`), `blockquote`, `codeBlock` (`language`),
  `horizontalRule`, `hardBreak`, `text`.
- Marks: `bold`, `italic`, `underline`, `strike`, `code`, `link` (`href`, `target`, `rel`).
- Links keep only `http`, `https`, `mailto`, `tel` and relative hrefs (like `/p/<pageId>`); other
  schemes are dropped when typed, pasted or loaded from HTML.
- Names are part of the stored data: later work may add nodes, marks and attributes but never
  renames them.

## Keyboard

- Markdown shortcuts: `#`, `##`, `###`, `-`, `*` or `+`, `1.`, `---`, and `**bold**`, `*italic*`,
  `` `code` ``. The rest of the spec's shortcuts come with their block groups.
- Ctrl/Cmd + B, I, U, Shift+S (strike), E (code). Ctrl/Cmd + Z undoes only your own changes
  (Yjs undo); Shift+Z or Y redoes. Tab and Shift+Tab indent and outdent list items.
