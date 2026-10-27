// Spaces and pages: the shapes the server checks and the web sends (decision 0007, section 4.1;
// Sidebar, spaces and nested pages spec).
import { z } from 'zod';
import type { AccessLevel } from './access';

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

// Pages, databases and rows (Pages and blocks 3.1; Sidebar spec 3.2).

export const PAGE_KINDS = ['page', 'database', 'row'] as const;
export const pageKindSchema = z.enum(PAGE_KINDS);
export type PageKind = z.infer<typeof pageKindSchema>;

/** A cover from Care Hub's own gallery, or an uploaded picture. */
export const pageCoverSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('preset'), name: z.string().min(1).max(64) }),
  z.strictObject({ type: z.literal('file'), fileId: z.uuid() }),
]);
export type PageCover = z.infer<typeof pageCoverSchema>;

export const PAGE_FONTS = ['default', 'serif', 'mono'] as const;
export type PageFont = (typeof PAGE_FONTS)[number];
export type TextDirection = 'ltr' | 'rtl';

/** One line of up to 2,000 characters; an empty title shows "Untitled". */
const pageTitle = z
  .string()
  .max(2000)
  .transform((title) => title.replace(/[\r\n]+/g, ' '));

/** POST /api/pages: under `parentId`, at the top of `spaceId`, or else in the Private section. */
export const createPageSchema = z.strictObject({
  spaceId: z.uuid().optional(),
  parentId: z.uuid().optional(),
  title: pageTitle.optional(),
  icon: pageIconSchema.nullable().optional(),
  /** Its place among the pages next to it (0 is first); last when left out. */
  index: z.int().min(0).max(100_000).optional(),
});
export type CreatePageInput = z.infer<typeof createPageSchema>;

/** PATCH /api/pages/:id (Can edit). A locked page takes nothing else until it's unlocked. */
export const updatePageSchema = z.strictObject({
  title: pageTitle.optional(),
  icon: pageIconSchema.nullable().optional(),
  cover: pageCoverSchema.nullable().optional(),
  /** How far down the picture the cover shows, 0 to 100 (Reposition). */
  coverPosition: z.int().min(0).max(100).optional(),
  fullWidth: z.boolean().optional(),
  font: z.enum(PAGE_FONTS).optional(),
  smallText: z.boolean().optional(),
  textDirection: z.enum(['ltr', 'rtl']).optional(),
  locked: z.boolean().optional(),
});
export type UpdatePageInput = z.infer<typeof updatePageSchema>;

/** POST /api/pages/cards */
export const pageCardsSchema = z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) });

/** Someone named on a page. Null in its place when their account is gone. */
export type PersonRef = { id: string; name: string };

/** A breadcrumb above the page. Pages the person can't open show as one `hidden` part. */
export type PageAncestor = { id: string; title: string; icon: PageIcon | null } | { hidden: true };

/** GET /api/pages/:id, and the answer to POST /api/pages and PATCH. */
export type PageJson = {
  id: string;
  kind: PageKind;
  isInline: boolean;
  spaceId: string;
  parentId: string | null;
  position: string;
  title: string;
  icon: PageIcon | null;
  cover: PageCover | null;
  coverPosition: number;
  fullWidth: boolean;
  font: PageFont;
  smallText: boolean;
  textDirection: TextDirection;
  /** False after "Stop inheriting". */
  inheritAccess: boolean;
  /** What the signed-in person may do here. */
  access: AccessLevel;
  /** `personal` is someone's Private section. */
  space: { id: string; name: string; icon: PageIcon | null; kind: SpaceKind | 'personal' };
  /** From the top of the space down to the parent. */
  ancestors: PageAncestor[];
  lockedBy: PersonRef | null;
  lockedAt: string | null;
  archivedBy: PersonRef | null;
  archivedAt: string | null;
  createdBy: PersonRef | null;
  createdAt: string;
  updatedBy: PersonRef | null;
  updatedAt: string;
  deletedBy: PersonRef | null;
  deletedAt: string | null;
};

/** What a link, mention, notice or chart shows for a page (`spaceName` is null for Private). */
export type PageCard = {
  id: string;
  kind: PageKind;
  title: string;
  icon: PageIcon | null;
  spaceName: string | null;
};
/** `deleted`: in Trash or gone. `locked`: the person can't open it, so nothing else is sent. */
export type PageCardEntry = PageCard | { id: string; deleted: true } | { id: string; locked: true };

/** POST /api/pages/cards: one entry per requested ID, in the same order. */
export type PageCardsJson = { cards: PageCardEntry[] };

// The sidebar tree and moving pages (Sidebar spec 3.2 and 5).

/** One entry of GET /api/spaces/:id/tree. Rows and inline databases are never in the tree. */
export type TreeNodeJson = {
  id: string;
  /** Null at the top of the space, and for pages under a page the person can't open. */
  parentId: string | null;
  kind: 'page' | 'database';
  title: string;
  icon: PageIcon | null;
  position: string;
  /** Sub-pages the person can open. Always false for databases (their views come from the lane). */
  hasChildren: boolean;
  access: AccessLevel;
  /** "In a page you can't open" (SB-06). That page's ID and title are never sent. */
  pathHidden?: true;
};

/**
 * GET /api/spaces/:id/tree: every entry the person can open, flat, in sidebar order (depth first,
 * each level by `position`). Pages under a page they can't open come last, at the top level.
 */
export type PageTreeJson = { nodes: TreeNodeJson[] };

/**
 * POST /api/pages/:id/move (Full access on the page, Can edit where it goes): under `parentId`, or
 * at the top of `spaceId` with `parentId: null`. A page moved into a database becomes a row, and
 * a row moved out becomes a page.
 */
export const movePageSchema = z
  .strictObject({
    parentId: z.uuid().nullable(),
    spaceId: z.uuid().optional(),
    /** Its place among its new neighbours (0 is first); last when left out. */
    index: z.int().min(0).max(100_000).optional(),
    /** Sent again after the person saw the access change (409 with `AccessChangeJson`). */
    confirmAccessChange: z.boolean().optional(),
  })
  .refine((move) => move.parentId !== null || move.spaceId !== undefined, {
    message: 'Choose a page or a space to move it to.',
  });
export type MovePageInput = z.infer<typeof movePageSchema>;

/** The `details` of a 409 when a move changes who can open the page. */
export type AccessChangeJson = { losing: number; gaining: number };

// Trash (Page history and Trash 3.4).

/** GET /api/trash: newest first, 100 at a time (`before` is the last entry's `deletedAt`). */
export const trashQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  deletedBy: z.uuid().optional(),
  spaceId: z.uuid().optional(),
  type: z.enum([...PAGE_KINDS, 'space']).optional(),
  before: z.iso.datetime().optional(),
});
export type TrashQuery = z.infer<typeof trashQuerySchema>;

/** A page, database or row with everything that went with it, or a space with its pages. */
export type TrashEntryJson = {
  id: string;
  type: PageKind | 'space';
  title: string;
  icon: PageIcon | null;
  /** Where it was ("Support › Policies"): its space (null for a space) and the pages above it. */
  space: { id: string; name: string; kind: SpaceKind | 'personal' } | null;
  ancestors: PageAncestor[];
  /** What went with it ("and 12 sub-pages"): pages and databases, and database rows. */
  subPages: number;
  rows: number;
  deletedBy: PersonRef | null;
  deletedAt: string;
  /** "Deletes in 12 days"; the last 3 days show in red. */
  deletesAt: string;
  canDeleteForever: boolean;
};

/** `retentionDays` is for "Trash is empty. Deleted pages stay here for 30 days." */
export type TrashJson = { entries: TrashEntryJson[]; retentionDays: number };

/**
 * POST /api/trash/:id/restore. When the place it came from is in Trash too, the answer is a 409
 * with `TrashPlaceJson` until the person picks "Restore both" (`withParents`) or "Move to…".
 */
export const restorePageSchema = z
  .strictObject({
    withParents: z.boolean().optional(),
    moveTo: z
      .strictObject({
        parentId: z.uuid().nullable(),
        spaceId: z.uuid().optional(),
        index: z.int().min(0).max(100_000).optional(),
      })
      .refine((move) => move.parentId !== null || move.spaceId !== undefined, {
        message: 'Choose a page or a space to move it to.',
      })
      .optional(),
  })
  .refine((input) => !(input.withParents && input.moveTo), {
    message: 'Restore it with its parents, or move it somewhere else.',
  });
export type RestorePageInput = z.infer<typeof restorePageSchema>;

/** The `details` of that 409: the page or space it was in (no title if the person can't open it). */
export type TrashPlaceJson = { type: 'page' | 'space'; id: string; title: string | null };
