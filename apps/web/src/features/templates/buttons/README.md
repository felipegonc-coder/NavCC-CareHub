# Buttons (web)

The "/button" block in the page editor (Templates and buttons spec, sections 2 and 3.4; Extras
lane, decision 0400). The block keeps only `buttonId`; the settings, presses, confirmations,
Undo and the run log are on the server under `/api/templates/buttons` (see the templates
server README). The schema of the `actionButton` and `templateVariable` nodes is in
`packages/editor/src/lanes/extras.ts`; this folder gives their views through the templates
feature's `editor` slot.

## Files

| File                                                        | What it does                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `slash.tsx`                                                 | "/button" in the "/" menu: adds the block; the button is made and its settings open once the block is there     |
| `block-view.tsx`                                            | The block in the editor: makes the button, finds the page, does the steps a press leaves to the page            |
| `button-block.tsx`                                          | The button: press, spinner, the confirmation, ✓, "Done · Undo" for 8 seconds, the failed step, ⚙ for editors    |
| `confirm-dialog.tsx`                                        | A Show a confirmation step: Continue or Cancel                                                                  |
| `settings.tsx`                                              | ⚙ Edit button: label, icon, color, who can press it, the steps (move, drag, remove), the sentence and last runs |
| `action-fields.tsx`, `values-field.tsx`, `blocks-field.tsx` | The fields of each kind of step, the values Add a row and Edit rows set, and the blocks Insert blocks adds      |
| `finish.ts`, `values.ts`                                    | The settings as they're saved, checked step by step ("Step 2: …"), and the values kept as Databases stores them |
| `page-steps.ts`                                             | Insert blocks next to the button (and taking them out on Undo), Open a page, Open a link                        |
| `page-id.ts`                                                | Which page the button is on, and `ButtonPageProvider`                                                           |
| `variable-chip.tsx`                                         | The purple chips: Today, Today + 3 days, Now, Me, This page                                                     |
| `store.ts`, `problems.tsx`                                  | Between the "/" menu and the new block, and the toast for problems a block can't show itself                    |
| `api.ts`                                                    | The buttons client, its query keys and `ButtonsClientProvider` for tests                                        |

## For the page view

Buttons need the page they're on. By default it's the page in the address (`/p/<pageId>`). Where
the editor shows another page (the side panel), wrap it in `<ButtonPageProvider value={pageId}>`;
on share-link pages use `value={null}`, which hides buttons.

## Later

- Send a notice to people and groups: only "everyone in the workspace" (Admins) until the
  accounts lane's people and groups picker is on main.
- The "/" menu inside a dialog (Insert blocks) gets `pointer-events: auto` from `blocks-field.tsx`
  until the editor sets it on its menu.
