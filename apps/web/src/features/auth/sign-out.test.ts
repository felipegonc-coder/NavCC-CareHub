import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import type { SignOutHook } from '../../slots';
import { meQueryKey } from './me';
import { runSignOutHooks, signOut } from './sign-out';
import {
  changes,
  createTestQueryClient,
  fakeAuthServer,
  json,
  meFor,
  restoreFetch,
  USER,
} from './test-utils';

const VIEWER = ['comments', 'viewer'];

function signedInDevice() {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(meQueryKey, meFor());
  queryClient.setQueryData(VIEWER, { id: USER.id, name: USER.name });
  return queryClient;
}

afterEach(() => {
  restoreFetch();
  vi.restoreAllMocks();
});

describe('signOut', () => {
  it('ends the session, runs the hooks, then clears the cache and opens sign-in', async () => {
    const order: string[] = [];
    fakeAuthServer(meFor(), {
      'POST /api/auth/sign-out': () => {
        order.push('server');
        return json(200, { ok: true });
      },
    });
    const queryClient = signedInDevice();
    const navigate = vi.fn(() => order.push('navigate'));
    const push = vi.fn(() => {
      // Hooks still see the cache, and the person who signed out.
      order.push(`push saw ${queryClient.getQueryData<{ name: string }>(VIEWER)?.name}`);
    });
    const hooks: SignOutHook[] = [{ id: 'push', run: push }];

    await signOut({ queryClient, navigate, hooks });

    expect(order).toEqual(['server', 'push saw Eli Editor', 'navigate']);
    expect(push).toHaveBeenCalledWith({ user: USER });
    expect(navigate).toHaveBeenCalledWith('/sign-in', { replace: true });
    expect(queryClient.getQueryData(VIEWER)).toBeUndefined();
    expect(queryClient.getQueryData(meQueryKey)).toBeUndefined();
  });

  it("changes nothing when the server can't be told, and says why", async () => {
    const server = fakeAuthServer(meFor(), {
      'POST /api/auth/sign-out': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const queryClient = signedInDevice();
    const navigate = vi.fn();
    const hook = vi.fn();

    const failure = await signOut({ queryClient, navigate, hooks: [{ id: 'queue', run: hook }] })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
    expect(changes(server)).toEqual(['POST /api/auth/sign-out']);
    expect(hook).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(VIEWER)).toEqual({ id: USER.id, name: USER.name });
  });

  it('sends one request when asked twice at once', async () => {
    const server = fakeAuthServer(meFor(), {
      'POST /api/auth/sign-out': () => json(200, { ok: true }),
    });
    const queryClient = signedInDevice();
    const navigate = vi.fn();
    await Promise.all([
      signOut({ queryClient, navigate, hooks: [] }),
      signOut({ queryClient, navigate, hooks: [] }),
    ]);
    expect(changes(server)).toEqual(['POST /api/auth/sign-out']);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('gives the hooks no person when none was loaded', async () => {
    fakeAuthServer(null, { 'POST /api/auth/sign-out': () => json(200, { ok: true }) });
    const hook = vi.fn();
    await signOut({
      queryClient: createTestQueryClient(),
      navigate: () => undefined,
      hooks: [{ id: 'queue', run: hook }],
    });
    expect(hook).toHaveBeenCalledWith({ user: null });
  });
});

describe('runSignOutHooks', () => {
  it('logs hooks that fail and goes on', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const after = vi.fn();
    await runSignOutHooks(
      [
        {
          id: 'throws',
          run: () => {
            throw new Error('throws');
          },
        },
        { id: 'rejects', run: () => Promise.reject(new Error('rejects')) },
        { id: 'after', run: after },
      ],
      { user: USER },
    );
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('Sign-out step "throws" failed.', expect.any(Error));
  });

  it('stops waiting for a hook that takes too long', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const quick = vi.fn();
    await runSignOutHooks(
      [
        { id: 'stuck', run: () => new Promise<void>(() => undefined) },
        { id: 'quick', run: quick },
      ],
      { user: USER },
      20,
    );
    expect(quick).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('Signed out without waiting longer for: stuck.');
  });
});
