// The settings as they're saved: each step checked in order, with "Step 2: …" in front of what's
// wrong, then the shared schema. The server checks them again (settingsProblem).
import type { DatabaseMeta } from '@carehub/databases';
import { isSafeWebLink } from '@carehub/databases/richtext';
import {
  BUTTON_MESSAGES,
  buttonSettingsSchema,
  type ButtonAction,
  type ButtonColor,
  type ButtonSettings,
  type ButtonWho,
} from '@carehub/extras/templates/buttons';
import { finishValues, namesFor } from './values';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ButtonDraft {
  label: string;
  /** An emoji, or '' for none. */
  icon: string;
  color: ButtonColor;
  who: ButtonWho;
  actions: ButtonAction[];
}

/** The draft ready to save, or what's wrong with it. */
export function finishSettings(
  draft: ButtonDraft,
  metaOf: (databaseId: string) => DatabaseMeta | undefined,
): { settings: ButtonSettings } | { problem: string } {
  const actions: ButtonAction[] = [];
  let rowMade = false;
  for (const [index, action] of draft.actions.entries()) {
    const problem = (message: string) => ({ problem: `Step ${index + 1}: ${message}` });
    switch (action.kind) {
      case 'insert_blocks':
        if (action.blocks.length === 0) return problem('Add the blocks to insert.');
        actions.push(action);
        break;
      case 'add_row':
      case 'edit_rows': {
        if (!UUID.test(action.databaseId)) return problem('Paste the link to a database.');
        const meta = metaOf(action.databaseId);
        const finished = finishValues(meta, action.values);
        if (finished.problem) return problem(finished.problem);
        if (action.kind === 'edit_rows' && Object.keys(finished.values).length === 0) {
          return problem('Choose what to change.');
        }
        const next = { ...action, values: finished.values };
        actions.push(meta ? { ...next, names: namesFor(next, meta) } : next);
        if (action.kind === 'add_row') rowMade = true;
        break;
      }
      case 'open_page':
        if (action.pageId === null && !rowMade) return problem(BUTTON_MESSAGES.noEarlierRow);
        if (action.pageId !== null && !UUID.test(action.pageId)) {
          return problem('Paste the link to the page to open.');
        }
        actions.push(action);
        break;
      case 'open_link': {
        const url = action.url.trim();
        if (!isSafeWebLink(url)) return problem(BUTTON_MESSAGES.badLink);
        actions.push({ ...action, url });
        break;
      }
      case 'send_message': {
        const { to } = action;
        const anyone =
          to.everyone || to.userIds.length + to.groupIds.length + to.roleIds.length > 0;
        if (!anyone) return problem('Choose who gets the message.');
        if (!action.message.trim()) return problem('Write the message.');
        if (action.card === 'new_row' && !rowMade) return problem(BUTTON_MESSAGES.noEarlierRow);
        actions.push(action);
        break;
      }
      case 'confirm':
        if (!action.title.trim()) return problem('Give it a title.');
        actions.push(action);
        break;
    }
  }
  const parsed = buttonSettingsSchema.safeParse({
    ...draft,
    icon: draft.icon.trim() || null,
    actions,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const [field, step] = issue?.path ?? [];
    const where = field === 'actions' && typeof step === 'number' ? `Step ${step + 1}: ` : '';
    return { problem: `${where}${issue?.message ?? 'Check the settings.'}` };
  }
  return { settings: parsed.data as ButtonSettings };
}
