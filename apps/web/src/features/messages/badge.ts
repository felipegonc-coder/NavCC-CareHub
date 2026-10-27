import { useNoticesUnread } from '../notices';
import { useMessagesUnread } from './data';

/** The sidebar badge: unread messages (MS-06) and unread notices; nothing when it's 0. */
export function useMessagesBadge(): number | undefined {
  const messages = useMessagesUnread();
  const notices = useNoticesUnread();
  const total = messages + notices;
  return total > 0 ? total : undefined;
}
