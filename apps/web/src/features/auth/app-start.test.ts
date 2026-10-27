import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import type { AppStart } from '../../slots';
import { resetAppStart, startApp } from './app-start';
import { USER } from './test-utils';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const ctx = (user = USER) => ({ api, navigate: () => undefined, user });

afterEach(() => {
  resetAppStart();
  vi.restoreAllMocks();
});

describe('startApp', () => {
  it('runs every item once per sign-in', async () => {
    const push = vi.fn();
    const chat = vi.fn(async () => undefined);
    const items: AppStart[] = [
      { id: 'push', run: push },
      { id: 'open-chat', run: chat },
    ];
    startApp(items, ctx());
    startApp(items, ctx());
    await flush();
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(expect.objectContaining({ user: USER, api }));
    expect(chat).toHaveBeenCalledTimes(1);

    startApp(items, ctx({ ...USER, id: 'someone-else' }));
    resetAppStart();
    startApp(items, ctx());
    await flush();
    expect(push).toHaveBeenCalledTimes(3);
  });

  it('logs an item that fails and still runs the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    startApp(
      [
        {
          id: 'broken',
          run: () => {
            throw new Error('broken');
          },
        },
        { id: 'rejects', run: () => Promise.reject(new Error('rejects')) },
        { id: 'after', run: after },
      ],
      ctx(),
    );
    await flush();
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('App start "broken" failed.', expect.any(Error));
  });
});
