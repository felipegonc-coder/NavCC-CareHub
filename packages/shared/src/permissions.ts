import { z } from 'zod';

/** What a workspace role can allow (spec: Roles and permissions). The server checks them on every request. */
export const PERMISSION_KEYS = [
  'pages.edit',
  'pages.create',
  'pages.comment',
  'pages.share',
  'templates.manage',
  'claude.use',
  'learning.build',
  'learning.assign',
  'learning.analytics',
  /** Share pages with guests and make guest accounts (while the workspace allows guests). */
  'guests.add',
  /** Make view-only share links (while the workspace allows them). */
  'pages.shareLinks',
  'workspace.admin',
] as const;
export const permissionKeySchema = z.enum(PERMISSION_KEYS);
export type PermissionKey = z.infer<typeof permissionKeySchema>;

export const BUILT_IN_ROLE_KEYS = ['admin', 'editor', 'commenter', 'viewer'] as const;
export const builtInRoleKeySchema = z.enum(BUILT_IN_ROLE_KEYS);
export type BuiltInRoleKey = z.infer<typeof builtInRoleKeySchema>;

export interface RoleDefinition {
  name: string;
  description: string;
  permissions: readonly PermissionKey[];
}

/** The roles every workspace has. They can't be changed or deleted; the server keeps them in step with this. */
export const BUILT_IN_ROLES = {
  admin: {
    name: 'Admin',
    description: 'Everything, including members, roles and workspace settings.',
    permissions: PERMISSION_KEYS,
  },
  editor: {
    name: 'Editor',
    description:
      'Create, edit, comment and share; add guests and share links; manage templates; use Claude.',
    permissions: [
      'pages.edit',
      'pages.create',
      'pages.comment',
      'pages.share',
      'templates.manage',
      'claude.use',
      'guests.add',
      'pages.shareLinks',
    ],
  },
  commenter: {
    name: 'Commenter',
    description: 'View and comment.',
    permissions: ['pages.comment'],
  },
  viewer: { name: 'Viewer', description: 'View only.', permissions: [] },
} as const satisfies Record<BuiltInRoleKey, RoleDefinition>;

/** Custom roles per workspace, and their names (Roles and permissions, section 3). */
export const MAX_CUSTOM_ROLES = 20;
export const roleNameSchema = z.string().trim().min(1).max(40);

/** `request.member` on the server (a Set), or `member` from GET /api/auth/me on the web (an array). */
export interface PermissionHolder {
  kind?: 'member' | 'guest';
  permissions: ReadonlySet<PermissionKey> | readonly PermissionKey[];
}

/**
 * Whether the member's role allows `key`. False when not a member, and for guests (their page grants decide).
 * Being a site admin doesn't count.
 */
export function hasPermission(
  member: PermissionHolder | null | undefined,
  key: PermissionKey,
): boolean {
  if (!member || member.kind === 'guest') return false;
  const { permissions } = member;
  return 'has' in permissions ? permissions.has(key) : permissions.includes(key);
}
