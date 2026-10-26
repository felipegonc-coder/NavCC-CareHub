import { z } from 'zod';

// Spaces (and, next, pages): the API contract shared by the server and the web app.
// Access rules: docs/decisions/0005-spaces-and-page-access.md.

const id = z.guid();

export const pageAccessLevelSchema = z.enum(['none', 'view', 'comment', 'edit']);
export type PageAccessLevel = z.infer<typeof pageAccessLevelSchema>;
/** A level someone actually has; hidden things are never returned. */
export const visibleAccessLevelSchema = pageAccessLevelSchema.exclude(['none']);
export type VisibleAccessLevel = z.infer<typeof visibleAccessLevelSchema>;

export const spaceKindSchema = z.enum(['team', 'private']);
export type SpaceKind = z.infer<typeof spaceKindSchema>;
/** Who sees a team space: everyone in the workspace, or only the people listed. */
export const spaceVisibilitySchema = z.enum(['workspace', 'members']);
export type SpaceVisibility = z.infer<typeof spaceVisibilitySchema>;
export const spaceRoleSchema = z.enum(['editor', 'commenter', 'viewer']);
export type SpaceRole = z.infer<typeof spaceRoleSchema>;

export const iconColors = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
const slug = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, digits and dashes');

/** True for exactly one emoji, including skin tones, flags, keycaps and joined sequences. */
export function isSingleEmoji(value: string): boolean {
  if (
    value.length > 32 ||
    !/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/u.test(value)
  ) {
    return false;
  }
  return (
    [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].length === 1
  );
}

/** A page or space icon: one emoji, or a Lucide icon name in one of our colors. */
export const pageIconSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('emoji'), emoji: z.string().refine(isSingleEmoji, 'Pick one emoji') }),
  z.object({ type: z.literal('icon'), name: slug, color: z.enum(iconColors) }),
]);
export type PageIcon = z.infer<typeof pageIconSchema>;

/** Where an item lands among its siblings: 0 is first; leave it out to put it last. */
export const listIndexSchema = z.number().int().min(0).max(100_000);

const hasChanges = (value: object) => Object.values(value).some((field) => field !== undefined);

/** GET /api/workspace/members: the people in the workspace, for pickers. */
export const memberSummarySchema = z.object({
  id,
  name: z.string(),
  avatar: z.string().nullable(),
  role: z.string(),
});
export type MemberSummary = z.infer<typeof memberSummarySchema>;

export const spaceSchema = z.object({
  id,
  name: z.string(),
  icon: pageIconSchema.nullable(),
  kind: spaceKindSchema,
  /** `null` for private spaces. */
  visibility: spaceVisibilitySchema.nullable(),
  /** Sort key: spaces (and pages) sort by plain string order of `position`. */
  position: z.string(),
  access: z.object({
    level: visibleAccessLevelSchema,
    /** Show "New page" only when this is true. */
    canCreatePages: z.boolean(),
    /** Team spaces: rename, reorder, change who sees it, delete. Private spaces: rename. */
    canManage: z.boolean(),
  }),
});
export type Space = z.infer<typeof spaceSchema>;

const spaceName = z.string().trim().min(1, 'Give the space a name').max(100);
const memberList = z
  .array(z.object({ userId: id, role: spaceRoleSchema }))
  .max(1000)
  .refine(
    (list) => new Set(list.map((m) => m.userId)).size === list.length,
    'List each person once',
  );

/** POST /api/spaces (admins): a new team space. */
export const createSpaceSchema = z.object({
  name: spaceName,
  icon: pageIconSchema.nullable().optional(),
  visibility: spaceVisibilitySchema.default('workspace'),
  members: memberList.optional(),
});
export type CreateSpace = z.input<typeof createSpaceSchema>;

/** PATCH /api/spaces/:id. Private spaces take only `name` and `icon`. */
export const updateSpaceSchema = z
  .object({
    name: spaceName.optional(),
    icon: pageIconSchema.nullable().optional(),
    visibility: spaceVisibilitySchema.optional(),
    position: listIndexSchema.optional(),
  })
  .refine(hasChanges, 'Nothing to update');
export type UpdateSpace = z.infer<typeof updateSpaceSchema>;

/** PUT /api/spaces/:id/members replaces the whole list. */
export const setSpaceMembersSchema = z.object({ members: memberList });
export type SetSpaceMembers = z.infer<typeof setSpaceMembersSchema>;

export const spaceMemberSchema = z.object({
  userId: id,
  name: z.string(),
  avatar: z.string().nullable(),
  role: spaceRoleSchema,
});
export type SpaceMember = z.infer<typeof spaceMemberSchema>;
