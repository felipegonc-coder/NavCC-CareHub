import { describe, expect, it } from 'vitest';
import type { PendingMessage } from './outbox';
import { buildRows } from './rows';
import { AVERY, message, SAM } from './test-data';

const prefs = { timeZone: 'America/Denver', use24h: false };
// Tuesday, Oct 27, 2026, 10:00 AM in Denver.
const now = new Date('2026-10-27T16:00:00Z');
const options = { viewerId: AVERY, newMessagesSeq: null, now, prefs };

const pending = (clientId: string, queuedAt: string): PendingMessage => ({
  clientId,
  chatId: 'c-1',
  text: 'On its way',
  status: 'sending',
  error: null,
  queuedAt,
});

const shape = (rows: ReturnType<typeof buildRows>) =>
  rows.map((row) => {
    if (row.kind === 'day') return `day ${row.label}`;
    if (row.kind === 'message') return `${row.message.seq}${row.first ? ' first' : ''}`;
    if (row.kind === 'pending')
      return `pending ${row.pending.clientId}${row.first ? ' first' : ''}`;
    return row.kind;
  });

describe('message list rows', () => {
  it('starts each day with a divider and groups one person’s messages within 5 minutes', () => {
    const rows = buildRows(
      [
        message(1, { createdAt: '2026-10-26T15:00:00Z' }),
        message(2, { createdAt: '2026-10-27T15:00:00Z' }),
        message(3, { createdAt: '2026-10-27T15:04:00Z' }),
        message(4, { createdAt: '2026-10-27T15:05:00Z', senderId: AVERY }),
        message(5, { createdAt: '2026-10-27T15:20:00Z', senderId: AVERY }),
      ],
      [],
      options,
    );
    expect(shape(rows)).toEqual([
      'day Yesterday',
      '1 first',
      'day Today',
      '2 first',
      '3',
      '4 first',
      '5 first',
    ]);
  });

  it('puts the "New messages" line above the first unread, and system lines on their own', () => {
    const rows = buildRows(
      [
        message(1),
        message(2, {
          kind: 'system',
          senderId: null,
          text: '',
          system: { kind: 'renamed', actorId: SAM, name: 'Rota' },
        }),
        message(3),
        message(4),
      ],
      [],
      { ...options, newMessagesSeq: 4 },
    );
    expect(shape(rows)).toEqual([
      'day Today',
      '1 first',
      'system',
      '3 first',
      'new-messages',
      '4 first',
    ]);
  });

  it('shows messages on their way last, once each, even when the sent one is back', () => {
    const rows = buildRows(
      [message(1, { senderId: AVERY, clientId: 'sent-1' })],
      [pending('sent-1', '2026-10-27T15:01:00Z'), pending('p-2', '2026-10-27T15:02:00Z')],
      options,
    );
    expect(shape(rows)).toEqual(['day Today', '1 first', 'pending p-2']);
  });
});
