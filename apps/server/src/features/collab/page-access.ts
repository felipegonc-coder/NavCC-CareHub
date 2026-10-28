import type { AccessLevel } from '@carehub/shared';
import type { Db } from '../../db';

/*
 * Stand-ins for what the pages feature gives other features (decision 0007, sections 3.3 and
 * 4.1). They refuse everything, so no page opens over the socket until the pages PR (#49)
 * replaces them with its own functions.
 */

/** The person's access to the page. */
export const getPageAccess: (
  db: Db,
  userId: string,
  pageId: string,
) => Promise<AccessLevel> = async () => 'none';

/** Whether the page is in the trash or locked (PB-22); null if there's no such page. */
export const getPageState: (
  db: Db,
  pageId: string,
) => Promise<{ trashed: boolean; locked: boolean } | null> = async () => null;
