// Live nudges for the sidebar and open pages (SB-05, PB-19), through Team tools' live hub. Events
// carry IDs only; browsers refetch through the access-checked routes.
import { atLeast } from '@carehub/shared';
import type { Db } from '../../db';
import { publishTopic, registerTopic } from '../live';
import { loadViewer, resolvePages } from './access';
import { spacePlace } from './tree';

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
  publishTopic(`space:${spaceId}`, { type: 'pages.tree', data: { spaceId } });

/** The page's header changed: title, icon, cover, style or lock. */
export const pageChanged = (pageId: string) =>
  publishTopic(`page:${pageId}`, { type: 'pages.page', data: { pageId } });
