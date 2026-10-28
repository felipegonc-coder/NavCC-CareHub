// What push delivery reads from other features, each through its index.ts (decision 0007).
import { notifyDecision } from '@carehub/team-chat';
import type { Db } from '../../db';
import { hasOpenTabs } from '../live';
import { getNotice } from '../notices';
import type { DeliverySources } from './delivery';

export function deliverySources(db: Db): DeliverySources {
  return {
    hasOpenTabs,
    getNotice: (noticeId) => getNotice(db, noticeId),
    decide: notifyDecision,
  };
}
