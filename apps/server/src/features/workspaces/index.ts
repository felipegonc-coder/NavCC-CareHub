// The current workspace and its members, for other features (decision 0007).
export {
  DEFAULT_WORKSPACE_NAME,
  addMember,
  getCurrentMember,
  getDefaultWorkspace,
  getMembership,
  memberJson,
  syncDefaultWorkspace,
  type AddMemberInput,
  type CurrentMember,
  type Member,
} from './members';
export { removeMember } from './removal';
export type { MemberRemovedEvent } from './events';
export { roles, workspaceMembers, workspaces } from './schema';
