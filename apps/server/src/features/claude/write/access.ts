// Who may use writing help (Claude features spec, section 5): a member with Use Claude, never a
// guest, with Can edit on the page. Accounts and the page model aren't on main yet (pull requests
// #55 and #49), so these are stand-ins that deny by default: nobody is a member and every page
// counts as missing, so writing help refuses everything and sends nothing. Tests bind fakes.
import type { AccessLevel } from '@carehub/shared';
import type { FastifyRequest } from 'fastify';
import type { Db, Tx } from '../../../db';

/** The Use Claude permission (Roles and permissions). */
export const USE_CLAUDE = 'claude.use';

/** The person's membership of the current workspace, as writing help needs it. */
export interface ClaudeMember {
  workspaceId: string;
  /** Has Use Claude. Always false for guests. */
  canUseClaude: boolean;
}

// stand-in: request.member (accounts 1b, #55). Until it's on main nobody is a member.
type MemberLookup = (request: FastifyRequest) => ClaudeMember | null;
const fromRequest: MemberLookup = (request) => {
  const { member } = request as unknown as {
    member?: { workspaceId?: unknown; kind?: unknown; permissions?: unknown };
  };
  if (!member || typeof member.workspaceId !== 'string') return null;
  const { kind, permissions } = member;
  const canUseClaude =
    kind === 'member' && permissions instanceof Set && permissions.has(USE_CLAUDE);
  return { workspaceId: member.workspaceId, canUseClaude };
};
let memberLookup = fromRequest;

/** Tests bind a fake membership; the returned function unbinds it. */
export function bindWriteMember(next: MemberLookup): () => void {
  memberLookup = next;
  return () => {
    if (memberLookup === next) memberLookup = fromRequest;
  };
}

export function memberOf(request: FastifyRequest): ClaudeMember | null {
  return memberLookup(request);
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
