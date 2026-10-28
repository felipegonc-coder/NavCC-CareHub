// Keeps track of edits and saves automatic versions (HT-01): the collaboration server's saves
// open a stretch of edits per page, and a periodic task saves a version for each stretch that's
// due. Pages deleted for good lose their versions (HT-11).
import type { FastifyInstance } from 'fastify';
import { registerPeriodicTask } from '../jobs';
import { publishTopic } from '../live';
import { hasPageModel } from './pages';
import { forgetPages, recordEdit, recordSavedEdits, saveDueVersions } from './versions';

export const VERSIONS_TASK = 'history.versions';
export const VERSIONS_EVERY_MS = 15_000;
const POLL_MS = 5_000;
/** Live topic `history:<pageId>`: open Version history windows and the restore note. */
export const TOPIC = 'history';

type LooseEvents = { on(name: string, handler: (payload: unknown) => unknown): () => void };

/** `pageId` and `pageIds` from an event payload, whichever it has. */
export function pageIdsOf(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const { pageId, pageIds } = payload as { pageId?: unknown; pageIds?: unknown };
  const ids = Array.isArray(pageIds) ? pageIds : [];
  return [...new Set([pageId, ...ids].filter((id): id is string => typeof id === 'string'))];
}

/** `{ pageId, userIds }` from page.contentSaved, or null when it doesn't look like that. */
function savedEdit(payload: unknown): { pageId: string; userIds: string[] } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { pageId, userIds } = payload as { pageId?: unknown; userIds?: unknown };
  if (typeof pageId !== 'string') return null;
  const ids = Array.isArray(userIds) ? userIds.filter((id) => typeof id === 'string') : [];
  return { pageId, userIds: ids };
}

/** The app whose versions the periodic task saves (tests start many apps). */
let activeApp: FastifyInstance | null = null;

/** Tells open Version history windows that the page's versions changed. */
export function versionsChanged(pageId: string): void {
  publishTopic(`${TOPIC}:${pageId}`, { type: 'history.versions', data: { pageId } });
}

export function startHistoryTracking(app: FastifyInstance): void {
  const db = app.db;
  const safely = (what: string, run: () => Promise<unknown>) =>
    run().catch((error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      app.log.warn(
        { code: typeof code === 'string' ? code : 'unknown' },
        `history: ${what} failed`,
      );
    });
  // page.contentSaved comes with the content API (#200) and page.deleted with the page model
  // (#49); their payloads are read loosely until they're declared.
  const events = app.events as unknown as LooseEvents;
  const unsubscribe = [
    events.on('page.contentSaved', (payload) => {
      const edit = savedEdit(payload);
      if (!edit || !hasPageModel()) return;
      return safely('recording edits', () => recordEdit(db, edit.pageId, edit.userIds, new Date()));
    }),
    events.on('page.deleted', (payload) =>
      safely('forgetting deleted pages', () => forgetPages(db, pageIdsOf(payload))),
    ),
  ];

  activeApp = app;
  registerPeriodicTask(VERSIONS_TASK, VERSIONS_EVERY_MS, async ({ signal }) => {
    if (!activeApp) return;
    const saved = await saveDueVersions(activeApp.db, new Date(), { signal });
    for (const version of saved) versionsChanged(version.pageId);
  });

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> | undefined;
  const poll = () => {
    // stand-in: page.contentSaved (#200) replaces this polling; with no page model, no queries.
    if (!hasPageModel()) return;
    running ??= safely('reading saves', () => recordSavedEdits(db)).finally(() => {
      running = undefined;
    });
  };
  app.addHook('onReady', async () => {
    timer = setInterval(poll, POLL_MS);
    timer.unref();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    for (const off of unsubscribe) off();
    if (activeApp === app) activeApp = null;
    await running;
  });
}
