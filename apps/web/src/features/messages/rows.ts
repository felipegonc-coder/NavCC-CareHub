import type { MessageJson } from '@carehub/team-chat';
import { dayDivider, dayOf, TIME_SETTINGS, type TimeSettings } from './format';
import type { PendingMessage } from './outbox';

/** One line of the message list. `first` starts a run of messages from one person. */
export type ListRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'new-messages'; key: string }
  | { kind: 'system'; key: string; message: MessageJson }
  | { kind: 'message'; key: string; message: MessageJson; first: boolean }
  | { kind: 'pending'; key: string; pending: PendingMessage; first: boolean };

/** Messages from one person within this long of each other share one name and time. */
const RUN_GAP_MS = 5 * 60_000;

export interface RowOptions {
  viewerId: string;
  /** The first unread message: the "New messages" line goes above it (MS-11). */
  newMessagesSeq: number | null;
  now: Date;
  prefs?: TimeSettings;
}

/** Day dividers, the "New messages" line, and the messages still on their way at the end. */
export function buildRows(
  messages: readonly MessageJson[],
  pending: readonly PendingMessage[],
  { viewerId, newMessagesSeq, now, prefs = TIME_SETTINGS }: RowOptions,
): ListRow[] {
  const rows: ListRow[] = [];
  let day: string | null = null;
  let run: { senderId: string | null; at: number } | null = null;

  const startsDay = (iso: string) => {
    const next = dayOf(iso, prefs);
    if (next === day) return false;
    day = next;
    rows.push({ kind: 'day', key: `day-${next}`, label: dayDivider(iso, now, prefs) });
    return true;
  };
  const startsRun = (senderId: string | null, iso: string) => {
    const at = Date.parse(iso);
    const first = run === null || run.senderId !== senderId || at - run.at > RUN_GAP_MS;
    run = { senderId, at };
    return first;
  };

  for (const message of messages) {
    if (startsDay(message.createdAt)) run = null;
    if (message.seq === newMessagesSeq) {
      rows.push({ kind: 'new-messages', key: 'new-messages' });
      run = null;
    }
    if (message.kind === 'system') {
      rows.push({ kind: 'system', key: message.id, message });
      run = null;
      continue;
    }
    const first = startsRun(message.senderId, message.createdAt);
    rows.push({ kind: 'message', key: message.id, message, first });
  }

  // A message that's both sent and still pending (the answer and a refetch crossed) shows once.
  const sent = new Set(messages.flatMap((message) => (message.clientId ? [message.clientId] : [])));
  for (const item of pending) {
    if (sent.has(item.clientId)) continue;
    if (startsDay(item.queuedAt)) run = null;
    const first = startsRun(viewerId, item.queuedAt);
    rows.push({ kind: 'pending', key: item.clientId, pending: item, first });
  }
  return rows;
}
