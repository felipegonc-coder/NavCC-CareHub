import { describe, expect, it } from 'vitest';
import type { MessageResponse } from '@carehub/team-chat';
import { ApiError } from '../../lib/api';
import { createOutbox, type OutboxDeps } from './outbox';
import { message } from './test-data';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An outbox whose server answers come from `answer`; every request is recorded. */
function setup(answer: (text: string, attempt: number) => Promise<MessageResponse>) {
  const posted: { chatId: string; clientId: string; text: string }[] = [];
  const sent: string[] = [];
  const later: (() => void)[] = [];
  let online = true;
  let ids = 0;
  const deps: OutboxDeps = {
    post: (chatId, body) => {
      posted.push({ chatId, ...body });
      const attempt = posted.filter((item) => item.clientId === body.clientId).length;
      return answer(body.text, attempt);
    },
    onSent: (_chatId, response) => sent.push(response.message.text),
    isOnline: () => online,
    newId: () => `client-${(ids += 1)}`,
    now: () => new Date('2026-10-27T15:00:00Z'),
    retryLater: (run) => later.push(run),
  };
  const outbox = createOutbox(deps);
  return {
    outbox,
    posted,
    sent,
    later,
    setOnline: (value: boolean) => {
      online = value;
    },
  };
}

const ok = (text: string) => Promise.resolve({ message: message(1, { text }), people: {} });
const offline = () => new ApiError(0, 'offline', "Couldn't reach Care Hub.");

describe('the outbox', () => {
  it('sends each chat’s messages one at a time, in order', async () => {
    const { outbox, posted, sent } = setup(ok);
    outbox.send('c-1', 'First');
    outbox.send('c-1', 'Second');
    expect(outbox.snapshot().map((item) => item.status)).toEqual(['sending', 'sending']);
    await settle();
    expect(posted.map((item) => item.text)).toEqual(['First', 'Second']);
    expect(sent).toEqual(['First', 'Second']);
    expect(outbox.snapshot()).toEqual([]);
  });

  it('keeps messages written offline and sends them in order when back online, never twice', async () => {
    const { outbox, posted, sent, setOnline } = setup(ok);
    setOnline(false);
    outbox.send('c-1', 'First');
    outbox.send('c-1', 'Second');
    await settle();
    expect(posted).toEqual([]);
    expect(outbox.snapshot().map((item) => item.status)).toEqual(['waiting', 'waiting']);
    setOnline(true);
    outbox.resume();
    outbox.resume();
    await settle();
    expect(sent).toEqual(['First', 'Second']);
    expect(posted).toHaveLength(2);
  });

  it('waits after a dropped connection and resends with the same ID', async () => {
    const { outbox, posted, sent, later } = setup((text, attempt) =>
      attempt === 1 ? Promise.reject(offline()) : ok(text),
    );
    outbox.send('c-1', 'Hello');
    await settle();
    expect(outbox.snapshot()[0]?.status).toBe('waiting');
    expect(later).toHaveLength(1);
    later[0]?.();
    await settle();
    expect(sent).toEqual(['Hello']);
    expect(posted.map((item) => item.clientId)).toEqual(['client-1', 'client-1']);
  });

  it('marks a refused message "Not sent", for Retry or Delete', async () => {
    const { outbox, sent } = setup((text, attempt) =>
      attempt === 1 ? Promise.reject(new ApiError(400, 'invalid', 'Too long.')) : ok(text),
    );
    const first = outbox.send('c-1', 'One');
    await settle();
    expect(outbox.snapshot()[0]).toMatchObject({ status: 'failed', error: 'Too long.' });
    outbox.retry(first);
    await settle();
    expect(sent).toEqual(['One']);

    const second = outbox.send('c-1', 'Two');
    await settle();
    outbox.discard(second);
    expect(outbox.snapshot()).toEqual([]);
  });

  it('forgets everything at sign-out, and an answer that comes after shows nowhere', async () => {
    let answerBefore = () => {};
    const { outbox, posted, sent } = setup((text) =>
      text === 'Before'
        ? new Promise<MessageResponse>((resolve) => {
            answerBefore = () => resolve({ message: message(1, { text }), people: {} });
          })
        : ok(text),
    );
    outbox.send('c-1', 'Before');
    outbox.send('c-1', 'Also before');
    outbox.clear();
    expect(outbox.snapshot()).toEqual([]);

    outbox.send('c-1', 'After');
    await settle();
    answerBefore();
    await settle();
    expect(sent).toEqual(['After']);
    expect(posted.map((item) => item.text)).toEqual(['Before', 'After']);
    expect(outbox.snapshot()).toEqual([]);
  });
});
