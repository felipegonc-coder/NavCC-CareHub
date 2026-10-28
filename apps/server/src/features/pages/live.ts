// Live nudges for the sidebar and open pages (SB-05, PB-19), through Team tools' live hub. Events
// carry IDs only; browsers refetch through the access-checked routes.
import { atLeast } from '@carehub/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db';
import { publishTopic, registerTopic } from '../live';
import { loadViewer, resolvePages, type Executor } from './access';
import { isUuid } from './http';
import { spacePlace } from './spaces';

/** `space:<id>`: someone who can see the space's tree. `page:<id>`: someone who can open it. */
export function registerPageTopics(db: Db): void {
  registerTopic('space', async ({ userId, topic }) => {
    const viewer = await loadViewer(db, userId);
    return spacePlace(db, viewer, topic.slice('space:'.length)).then(
      () => true,
      () => false,
    );
  });
  registerTopic('page', async ({ userId, topic }) => {
    const pageId = topic.slice('page:'.length);
    const answer = (await resolvePages(db, await loadViewer(db, userId), [pageId])).get(pageId);
    return answer !== undefined && !answer.deleted && atLeast(answer.level, 'view');
  });
}

/** The space's tree changed: a page was added, renamed, moved or given a new icon. */
export const treeChanged = (spaceId: string) =>
  publishTopic(`space:${spaceId}`, { type: 'tree-changed', data: { spaceId } });

/** The page's header changed: title, icon, cover, style or lock. */
export const pageChanged = (pageId: string) =>
  publishTopic(`page:${pageId}`, { type: 'page-changed', data: { pageId } });

/**
 * After a commit that changed a page's title, icon, cover or style outside these routes (History's
 * restore): open pages and sidebars refetch it. The caller also emits `page.updated` with the keys
 * that changed (`setPageLook` returns them), so search reads the title again.
 */
export async function nudgePage(db: Executor, pageId: string): Promise<void> {
  const { rows } = await db.execute<{ spaceId: string; inTree: boolean }>(sql`
    SELECT space_id AS "spaceId", kind <> 'row' AND NOT is_inline AS "inTree"
    FROM pages WHERE id = ${isUuid(pageId) ? pageId : null}::uuid`);
  pageChanged(pageId);
  if (rows[0]?.inTree) treeChanged(rows[0].spaceId);
}
