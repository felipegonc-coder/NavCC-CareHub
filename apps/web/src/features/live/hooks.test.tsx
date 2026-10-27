import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setLiveClientForTest, type LiveEvent } from './client';
import { useLiveEvent, useLiveTopic } from './hooks';
import { createFakeLive } from './testSource';

function install() {
  const live = createFakeLive();
  setLiveClientForTest(live.client);
  return live;
}

afterEach(() => {
  setLiveClientForTest(null);
});

describe('useLiveEvent', () => {
  it('calls the newest handler without subscribing again', async () => {
    const live = install();
    const first: LiveEvent[] = [];
    const second: LiveEvent[] = [];
    const { rerender, unmount } = renderHook(
      ({ events }: { events: LiveEvent[] }) =>
        useLiveEvent('job-updated', (event) => {
          events.push(event);
        }),
      { initialProps: { events: first } },
    );
    await act(() => live.open());
    rerender({ events: second });
    await act(async () => {
      live.send({ type: 'job-updated', data: { jobId: 'j-1' } });
      live.send({ type: 'notice-created' });
    });
    expect(first).toEqual([]);
    expect(second).toEqual([{ type: 'job-updated', data: { jobId: 'j-1' } }]);
    expect(live.sources).toHaveLength(1);
    unmount();
  });

  it('passes on live-reconnected after a reconnect', async () => {
    const live = install();
    const events: LiveEvent[] = [];
    renderHook(() => useLiveEvent('job-updated', (event) => events.push(event)));
    await act(() => live.open());
    await act(async () => {
      live.last().emit('bye', { reason: 'replaced' });
      live.wake();
      await live.open();
    });
    expect(events).toEqual([{ type: 'live-reconnected' }]);
  });
});

describe('useLiveTopic', () => {
  it('subscribes to the current topic only, and to nothing while it is null', async () => {
    const live = install();
    const events: LiveEvent[] = [];
    const { rerender, unmount } = renderHook(
      ({ topic }: { topic: string | null }) => useLiveTopic(topic, (event) => events.push(event)),
      { initialProps: { topic: null } as { topic: string | null } },
    );
    expect(live.sources).toHaveLength(0);

    rerender({ topic: 'chat:c-1' });
    await act(() => live.open());
    expect([...live.subscribed]).toEqual(['chat:c-1']);
    await act(async () => {
      live.send({ type: 'message-created', data: { messageId: 'm-1' } }, 'chat:c-1');
    });
    expect(events).toEqual([{ type: 'message-created', data: { messageId: 'm-1' } }]);

    await act(async () => {
      rerender({ topic: 'chat:c-2' });
    });
    expect([...live.subscribed]).toEqual(['chat:c-2']);

    await act(async () => {
      unmount();
    });
    expect([...live.subscribed]).toEqual([]);
  });
});
