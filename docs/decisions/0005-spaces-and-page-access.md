# 0005: Spaces and page access

- **Status:** proposed (2026-10-27)
- **Context:** Pages live in spaces: shared team spaces and a private space per person, each with a choice of who can see it. Every request must be checked on the server, and live co-editing and comments (later) need the same answer to "what may this person do with this page?".

## Decision

1. **Spaces.** A workspace has team spaces and one private space per person, created the first time it's needed (when the person lists their spaces).
2. **Who sees what.**
   - Private space: only the owner. Admins can't see other people's private spaces.
   - Team space, visibility `workspace`: everyone in the workspace.
   - Team space, visibility `members`: the people listed in `space_members`, plus admins.
   - Someone who leaves the workspace loses access at once, even if still listed in a space.
3. **Levels:** `edit` if the workspace role has `pages.edit`, `comment` if it has `pages.comment`, otherwise `view`.
   - Private space and `workspace` team spaces: the level comes from the workspace role.
   - `members` team spaces: the lower of that level and the space role (`editor` = edit, `commenter` = comment, `viewer` = view).
   - Admins have `edit` in every team space.
4. **Creating pages** needs `pages.create` in the workspace role, and in a `members` space also the `editor` space role. Moving a page into another space counts as creating there.
5. **Managing spaces.** Only admins create team spaces and change their name, icon, order, visibility and members. A team space can be deleted only when it has no live pages. Owners can rename their private space; it can't be shared or deleted.
6. **One place for the rules.** `resolveSpaceAccess`, `getPageAccess(db, userId, pageId)` (`none`, `view`, `comment` or `edit`; `none` for pages in the trash) and the `requirePageAccess(level)` preHandler live in `apps/server/src/features/pages/access.ts`. Routes, live co-editing and comments all use them.
7. **Hidden means 404.** A space or page the person can't see answers 404, never 403, so IDs don't reveal what exists. 403 is only for things they can see but not change.
8. **Stable IDs and order.** Pages have UUIDs that never change and open at `/p/<pageId>`, so links survive renames and moves. Siblings sort by a fractional key (`position`, `COLLATE "C"`), so a move rewrites one row (cross-space moves also update the sub-pages' space). A parent is always in the same space (composite foreign key), and moves under a per-workspace lock reject cycles.

## Consequences

- Changing a role's permissions changes page access everywhere at once.
- Viewers can't create pages, even in their private space. If Felipe wants otherwise, change the private-space line in `resolveSpaceAccess`.
- The pages routes come next, then the trash, favorites and recent pages, all on these rules.
