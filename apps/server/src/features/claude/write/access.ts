// Who may use writing help (Claude features spec, section 5): a member with Use Claude, never a
// guest, with Can edit on the page. Membership and Use Claude come from the Claude core
// (`claudeMemberOf` and `canUseClaude`), which roles bind once for every Claude feature. The page
// model isn't on main yet (#49), so the page lookup is a stand-in that denies by default: every
// page counts as missing, so writing help refuses everything and sends nothing. Tests bind fakes.
import type { AccessLevel } from '@carehub/shared';
import type { Db, Tx } from '../../../db';
import { claudeMemberOf } from '../server/members';
import { claudeRuntime } from '../server/runtime';

/** The member's workspace if they have Use Claude there; null for guests and everyone else. */
export async function writerOf(
  db: Db | Tx,
  userId: string,
): Promise<{ workspaceId: string } | null> {
  const member = await claudeMemberOf(db, userId);
  if (!member) return null;
  const canUse = await claudeRuntime().access.canUseClaude(db, member.workspaceId, userId);
  return canUse ? { workspaceId: member.workspaceId } : null;
}

/** A page as writing help needs it: its workspace, title and the person's level on it. */
export interface ClaudePage {
  workspaceId: string;
  title: string;
  level: AccessLevel;
}

/** The page, or null when it's missing or in Trash. */
export type PageLookup = (
  db: Db | Tx,
  userId: string,
  pageId: string,
) => Promise<ClaudePage | null>;

// stand-in: the page and the person's access from features/pages (#49). Every page is missing.
const missing: PageLookup = async () => null;
let pageLookup = missing;

/** Binds the page model; the returned function unbinds it. */
export function bindWritePages(next: PageLookup): () => void {
  pageLookup = next;
  return () => {
    if (pageLookup === next) pageLookup = missing;
  };
}

export function pageFor(db: Db | Tx, userId: string, pageId: string): Promise<ClaudePage | null> {
  return pageLookup(db, userId, pageId);
}
