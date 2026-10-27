/**
 * Who an automation acts as (Automations spec, sections 3 and 5): its owner, with the access the
 * owner has when it runs, never more. Each run checks its owner first (running.ts), and each
 * action checks what it uses with the owner's access.
 */

/** A member of the workspace now. Guests are left out: they have no Messages. */
export interface Person {
  userId: string;
  name: string;
  roleId: string | null;
  isAdmin: boolean;
}

/** The workspace's members now, with who's an Admin. */
export type People = (workspaceId: string) => Promise<readonly Person[]>;

/** Why the server switched an automation off: its owner left the workspace. */
export const OWNER_LEFT = 'Its owner left the workspace.';
/** Why it paused one: only Admins have automations (AU-D1), and its owner isn't one now. */
export const OWNER_NOT_ADMIN = "Its owner isn't an Admin anymore.";

/** Paused because of its owner, so the Admin who switches it back on becomes its owner. */
export function pausedForOwner(reason: string | null): boolean {
  return reason === OWNER_LEFT || reason === OWNER_NOT_ADMIN;
}
