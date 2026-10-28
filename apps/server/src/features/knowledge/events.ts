// The knowledge base's events for other features (core/events.ts). Search keeps ✓ Verified in its
// index from `knowledge.verification.changed` (Search spec, section 4; SR-05) and reads the current
// state with `verificationOf` when it builds the index.
import type { VerificationState } from '@carehub/extras/knowledge';
import { inArray } from 'drizzle-orm';
import type { CareHubEvents, EventBus } from '../../core/events';
import type { Db, Tx } from '../../db';
import { kbPages } from './schema';

export interface KnowledgeVerification {
  state: VerificationState;
  /** Verified until (`YYYY-MM-DD`); null for no end date or Not verified. */
  until: string | null;
}

export type KnowledgeVerificationChanged = KnowledgeVerification & {
  workspaceId: string;
  pageId: string;
};

declare module '../../core/events' {
  interface CareHubEvents {
    'knowledge.verification.changed': KnowledgeVerificationChanged;
  }
}

let bus: EventBus<CareHubEvents> | null = null;

/** routes.ts binds the app's events; the returned function unbinds them. */
export function bindKnowledgeEvents(events: EventBus<CareHubEvents>): () => void {
  bus = events;
  return () => {
    if (bus === events) bus = null;
  };
}

/** After the commit. */
export function verificationChanged(change: KnowledgeVerificationChanged): void {
  bus?.emit('knowledge.verification.changed', change);
}

/** The pages' verification, for Search. Pages outside a knowledge base aren't in the map. */
export async function verificationOf(
  db: Db | Tx,
  pageIds: readonly string[],
): Promise<Map<string, KnowledgeVerification>> {
  if (pageIds.length === 0) return new Map();
  const rows = await db
    .select({
      pageId: kbPages.pageId,
      verification: kbPages.verification,
      until: kbPages.verifiedUntil,
    })
    .from(kbPages)
    .where(inArray(kbPages.pageId, [...pageIds]));
  return new Map(
    rows.map((row) => [row.pageId, { state: row.verification ?? 'none', until: row.until }]),
  );
}
