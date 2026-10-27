// The other features push delivery reads from, each through its index.ts (decision 0007).
import { notifyDecision } from '@carehub/team-chat';
import type { Db } from '../../db';
import { hasOpenTabs } from '../live';
import { getMessageForPush } from '../messages';
import { getNotice } from '../notices';
import type { DeliverySources } from './delivery';

export function deliverySources(db: Db): DeliverySources {
  return {
    hasOpenTabs,
    getNotice: (noticeId) => getNotice(db, noticeId),
    getMessage: (messageId, userId) => getMessageForPush(db, messageId, userId),
    decide: notifyDecision,
  };
}
