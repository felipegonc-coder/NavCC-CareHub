/**
 * When an owner leaves the workspace (Automations spec, section 3: Running), their automations
 * switch off, saying why, and every Admin gets a 🔔 notice. The Admin who switches one back on
 * becomes its owner, so failures still reach someone.
 */
import type { SendNoticeInput } from '../notices';
import type { Automation, AutomationStore } from './domain/types';
import { OWNER_LEFT, type Person } from './access';
import { senderFor } from './running';

export interface OwnerLeftOptions {
  store: AutomationStore;
  /** The workspace's members now, with who's an Admin. */
  people: (workspaceId: string) => Promise<readonly Person[]>;
  /** `sendNotice` from features/notices. */
  sendNotice: (input: SendNoticeInput) => Promise<unknown>;
  now?: () => Date;
}

/** What the Admins are told: one notice for all of that owner's automations. */
function noticeFor(
  switchedOff: readonly Automation[],
): Omit<SendNoticeInput, 'workspaceId' | 'userId'> {
  const [only] = switchedOff;
  if (only && switchedOff.length === 1) {
    return {
      kind: 'automation',
      sender: senderFor(only.name),
      title: 'An automation was switched off',
      text: `${OWNER_LEFT} Switch it back on to become its owner.`,
      buttons: [{ label: 'Open it', href: `/settings/automations/${only.id}` }],
    };
  }
  return {
    kind: 'automation',
    sender: 'Automations',
    title: `${switchedOff.length} automations were switched off`,
    text: 'Their owner left the workspace. Switch one back on to become its owner.',
    buttons: [{ label: 'See automations', href: '/settings/automations' }],
  };
}

/** Handles `member.removed`: switches off what they owned and tells the Admins. */
export function createOwnerLeft(options: OwnerLeftOptions) {
  const now = options.now ?? (() => new Date());

  return async function ownerLeft(member: { workspaceId: string; userId: string }): Promise<void> {
    const { workspaceId, userId } = member;
    const at = now();
    const owned = await options.store.list(workspaceId, { ownerUserId: userId, enabled: true });
    const switchedOff: Automation[] = [];
    for (const automation of owned) {
      const patch = { enabled: false, nextRunAt: null, pausedReason: OWNER_LEFT };
      const updated = await options.store.update(workspaceId, automation.id, patch, at);
      if (updated) switchedOff.push(updated);
    }
    if (switchedOff.length === 0) return;
    const notice = noticeFor(switchedOff);
    for (const person of await options.people(workspaceId)) {
      if (person.isAdmin)
        await options.sendNotice({ workspaceId, userId: person.userId, ...notice });
    }
  };
}
