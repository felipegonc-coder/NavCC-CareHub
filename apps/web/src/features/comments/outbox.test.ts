import type { CreateCommentInput, CreateCommentResponse } from '@carehub/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api';
import { Outbox } from './outbox';
import { PAGE_ID, THREAD_ID } from './testServer';

const input: CreateCommentInput = { pageId: PAGE_ID, threadId: THREAD_ID, text: 'Thursday works.' };
const sent: CreateCommentResponse = { id: 'comment-2', threadId: THREAD_ID };

describe('Outbox', () => {
  it('holds a comment while it is sent, then lets it go', async () => {
    let deliver: (value: CreateCommentResponse) => void = () => undefined;
    const outbox = new Outbox(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    let changes = 0;
    const stop = outbox.subscribe(() => {
      changes += 1;
    });
    const result = outbox.send(input);
    expect(outbox.getSnapshot()).toEqual([{ id: 'outgoing-1', input, status: 'sending' }]);
    deliver(sent);
    expect(await result).toEqual(sent);
    expect(outbox.getSnapshot()).toEqual([]);
    expect(changes).toBe(2);
    stop();
    void outbox.send(input);
    expect(changes).toBe(2);
  });

  it('keeps a comment that failed, with the reason, until it is sent again', async () => {
    let attempts = 0;
    const outbox = new Outbox(async () => {
      attempts += 1;
      if (attempts === 1) throw new ApiError(429, 'rate_limited', 'Too many comments. Wait a bit.');
      return sent;
    });
    expect(await outbox.send(input)).toBeNull();
    expect(outbox.getSnapshot()).toMatchObject([
      { id: 'outgoing-1', input, status: 'failed', error: 'Too many comments. Wait a bit.' },
    ]);
    expect(await outbox.retry('outgoing-1')).toEqual(sent);
    expect(outbox.getSnapshot()).toEqual([]);
  });

  it('drops a failed comment on Delete', async () => {
    const outbox = new Outbox(() => Promise.reject(new TypeError('Failed to fetch')));
    await outbox.send(input);
    expect(outbox.getSnapshot()).toMatchObject([
      { status: 'failed', error: 'Something went wrong. Try again.' },
    ]);
    outbox.discard('outgoing-1');
    expect(outbox.getSnapshot()).toEqual([]);
    expect(await outbox.retry('outgoing-1')).toBeNull();
  });
});
