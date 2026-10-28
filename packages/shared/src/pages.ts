// Spaces and pages: the shapes the server checks and the web sends (decision 0007, section 4.1;
// Sidebar, spaces and nested pages spec).
import { z } from 'zod';

/** A page or space icon: an emoji, or one of the design kit's icons in one of its colours. */
export const pageIconSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('emoji'), emoji: z.string().min(1).max(32) }),
  z.strictObject({
    type: z.literal('icon'),
    name: z.string().min(1).max(64),
    color: z.string().min(1).max(32),
  }),
]);
export type PageIcon = z.infer<typeof pageIconSchema>;

/** Team spaces. Each person's own Private section isn't a space they can join or change. */
export const SPACE_KINDS = ['open', 'closed', 'private'] as const;
export const spaceKindSchema = z.enum(SPACE_KINDS);
export type SpaceKind = z.infer<typeof spaceKindSchema>;

/** What members get on the space's pages unless a page has its own access. Owners get Full. */
export const spaceDefaultAccessSchema = z.enum(['full', 'edit', 'comment', 'view']);
export type SpaceDefaultAccess = z.infer<typeof spaceDefaultAccessSchema>;

export const spaceRoleSchema = z.enum(['owner', 'member']);
export type SpaceRole = z.infer<typeof spaceRoleSchema>;

const spaceName = z.string().trim().min(1).max(60);
const spaceDescription = z.string().trim().max(1000);

/** POST /api/spaces */
export const createSpaceSchema = z.strictObject({
  name: spaceName,
  icon: pageIconSchema.nullable().optional(),
  description: spaceDescription.optional(),
  kind: spaceKindSchema.default('open'),
  defaultAccess: spaceDefaultAccessSchema.default('edit'),
});
export type CreateSpaceInput = z.infer<typeof createSpaceSchema>;

/** PATCH /api/spaces/:id. `isDefault` and unarchiving are for Admins. */
export const updateSpaceSchema = z.strictObject({
  name: spaceName.optional(),
  icon: pageIconSchema.nullable().optional(),
  description: spaceDescription.optional(),
  kind: spaceKindSchema.optional(),
  defaultAccess: spaceDefaultAccessSchema.optional(),
  ownersOnlyTopLevel: z.boolean().optional(),
  allowShareLinks: z.boolean().optional(),
  allowGuests: z.boolean().optional(),
  allowExport: z.boolean().optional(),
  allowMoveOut: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  archived: z.boolean().optional(),
});
export type UpdateSpaceInput = z.infer<typeof updateSpaceSchema>;

/** GET /api/spaces?scope=: `mine` (the sidebar), `browse` (Open and Closed) or `all` (Admins). */
export const listSpacesQuerySchema = z.object({
  scope: z.enum(['mine', 'browse', 'all']).default('mine'),
});

/** POST /api/spaces/:id/members. Groups come with Settings → Members. */
export const addSpaceMembersSchema = z.strictObject({
  members: z
    .array(z.strictObject({ type: z.enum(['user', 'group']), id: z.uuid() }))
    .min(1)
    .max(100),
  role: spaceRoleSchema.default('member'),
});

/** PATCH /api/spaces/:id/members/:memberId */
export const updateSpaceMemberSchema = z.strictObject({ role: spaceRoleSchema });

export type SpaceJson = {
  id: string;
  name: string;
  icon: PageIcon | null;
  description: string;
  kind: SpaceKind;
  defaultAccess: SpaceDefaultAccess;
  ownersOnlyTopLevel: boolean;
  allowShareLinks: boolean;
  allowGuests: boolean;
  allowExport: boolean;
  allowMoveOut: boolean;
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
  memberCount: number;
  /** The signed-in person's place in the space, or null. */
  myRole: SpaceRole | null;
  /** Owners and Admins change the settings and members. */
  canManage: boolean;
};

/** GET /api/spaces */
export type SpaceListJson = {
  spaces: SpaceJson[];
  /** The person's own Private section (null for guests). */
  privateSpaceId: string | null;
};

export type SpaceMemberJson = {
  type: 'user' | 'group';
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
  role: SpaceRole;
  joinedAt: string;
};
