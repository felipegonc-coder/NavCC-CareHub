import type { Db, Tx } from '../../../db';

// stand-in: request.member / getMembership and hasPermission from the roles PR (#55). Until it's
// bound, nobody is in a workspace: GET /api/claude/status says everything is off, and Settings →
// Claude answers 403.

export interface ClaudeMember {
  workspaceId: string;
  /** The person's role has workspace.admin. */
  isAdmin: boolean;
}

export type ClaudeMemberLookup = (db: Db | Tx, userId: string) => Promise<ClaudeMember | null>;

const nobody: ClaudeMemberLookup = async () => null;
let lookup = nobody;

/** The signed-in person's membership of the current workspace, or null (guests count as null). */
export function claudeMemberOf(db: Db | Tx, userId: string): Promise<ClaudeMember | null> {
  return lookup(db, userId);
}

/** Binds the lookup (the roles PR, or a test); the returned function unbinds it. */
export function bindClaudeMembers(next: ClaudeMemberLookup): () => void {
  lookup = next;
  return () => {
    if (lookup === next) lookup = nobody;
  };
}
