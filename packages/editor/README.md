# @carehub/editor

The Care Hub page editor: Tiptap 3 (open-source extensions only) on Yjs.

```tsx
import { BlockEditor } from '@carehub/editor';

<BlockEditor ydoc={ydoc} user={{ id, name, color }} awareness={provider.awareness} />;
```

- Works on a local `Y.Doc`. Connect a Hocuspocus provider to the same doc to share it, and pass its
  `awareness` to show other people's carets.
- `BlockEditor` imports its own content styles. The "/" menu uses `@carehub/ui` Tailwind colors, so
  the app's Tailwind `content` must include `packages/*/src` (`apps/web` already does).

## Props

| Prop          | Default            | Notes                                                        |
| ------------- | ------------------ | ------------------------------------------------------------ |
| `ydoc`        | required           | The page's `Y.Doc`.                                          |
| `field`       | `'default'`        | XML fragment in `ydoc` that holds the page.                  |
| `user`        | required           | `{ id, name, color }`; `color` is a CSS color for the caret. |
| `awareness`   | `null`             | The provider's awareness: shows carets and selections.       |
| `editable`    | `true`             | `false` makes it read-only (and hides the "/" menu).         |
| `placeholder` | `Type '/' for ...` | Shown in an empty page.                                      |
| `ariaLabel`   | `'Page content'`   | Accessible name of the editing area (read on mount).         |
| `onReady`     |                    | Gets the Tiptap `Editor` once it exists.                     |
| `extensions`  | `[]`               | Extra Tiptap nodes, marks and extensions (read on creation). |
| `slashItems`  | `[]`               | Extra "/" menu entries.                                      |

## Extension points (shared contract, see docs/decisions/0007)

- **`extensions?: AnyExtension[]`**: for example a `database` node with a React node view, or a
  meeting-notes block. They are read when the editor is created; remount it (with a `key`) to
  change them.
- **`slashItems?: SlashItem[]`**: `{ id, title, description?, icon?, keywords?, group?, run(editor) }`.
  `run` is called after the typed "/query" is removed. Entries are listed under their `group`
  (default "Other"; the built-in ones are "Basic blocks"). An entry with the `id` of a basic block
  (`paragraph`, `heading1`-`heading3`, `bulletList`, `orderedList`, `taskList`, `quote`, `divider`,
  `codeBlock`) replaces it.
- **`linkPickers?: LinkPicker[]`** (`{ label, pick(): Promise<string | null> }`, resolving to a
  relative href) and **`bubbleItems?: BubbleItem[]`** (`{ id, label, icon?, isActive?(editor),
run(editor) }`): the types are exported now; the selection toolbar that shows them comes in the
  next pull request.

```tsx
const Database = Node.create({ name: 'database', group: 'block', atom: true /* ... */ });

<BlockEditor
  ydoc={ydoc}
  user={user}
  extensions={[Database]}
  slashItems={[
    {
      id: 'database',
      title: 'Database',
      group: 'Databases',
      icon: <Table2 size={18} />,
      run: (editor) => editor.chain().insertContent({ type: 'database' }).run(),
    },
  ]}
/>;
```

**Every editor that opens a page must load the same extensions.** When y-prosemirror meets a node
it doesn't know, it removes it from the shared `Y.Doc`, so one client without the `database`
extension would delete every database block for everyone. Register lane extensions in one place.

## Document format

- The page lives in the `Y.Doc` XML fragment `default`.
- Nodes: `doc`, `paragraph`, `heading` (`level` 1-3), `bulletList`, `orderedList`, `listItem`,
  `taskList`, `taskItem` (`checked`), `blockquote`, `codeBlock` (`language`), `horizontalRule`,
  `hardBreak`, `text`.
- Marks: `bold`, `italic`, `underline`, `strike`, `code`, `link` (`href`, `target`, `rel`).
- Links keep only `http`, `https`, `mailto`, `tel` and relative hrefs (like `/p/<pageId>`); other
  schemes are dropped when typed, pasted or loaded from HTML.
- Undo and redo come from Yjs, so they only undo your own changes.
- Names are part of the stored data: later work may add nodes and marks but never renames them.

## Keyboard

- "/" opens the block menu: arrow keys, Enter, Escape. It doesn't open inside code or mid-word.
- Markdown shortcuts: `#`, `##`, `###`, `-` or `*`, `1.`, `[]`, `>`, ` ``` `, `---`, and
  `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``.
- Ctrl/Cmd + B, I, U, Shift+S (strike), E (code); Ctrl/Cmd + Z, Shift+Z or Y for undo and redo;
  Tab and Shift+Tab indent and outdent list items.
