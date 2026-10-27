import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../lib/api';
import type { BeforeSignOutContext } from '../../slots';
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
  it('runs beforeSignOut while the session works, ends it, runs signOut, then clears the cache', async () => {
    const order: string[] = [];
    fakeAuthServer(meFor(), {
      'DELETE /api/push/subscription': () => {
        order.push('push told the server');
        return json(200, { ok: true });
      },
      'POST /api/auth/sign-out': () => {
        order.push('server');
        return json(200, { ok: true });
      },
    });
    const queryClient = signedInDevice();
    const navigate = vi.fn(() => order.push('navigate'));
    const push = vi.fn(async ({ api: client }: BeforeSignOutContext) => {
      await client.delete('/api/push/subscription');
    });
    const queue = vi.fn(() => {
      // signOut hooks still see the cache, and the person who signed out.
      order.push(`queue saw ${queryClient.getQueryData<{ name: string }>(VIEWER)?.name}`);
    });

    await signOut({
      queryClient,
      navigate,
      beforeHooks: [{ id: 'push', run: push }],
      hooks: [{ id: 'queue', run: queue }],
    });

    expect(order).toEqual(['push told the server', 'server', 'queue saw Eli Editor', 'navigate']);
    expect(push).toHaveBeenCalledWith({ api, user: USER });
    expect(queue).toHaveBeenCalledWith({ user: USER });
    expect(navigate).toHaveBeenCalledWith('/sign-in', { replace: true });
    expect(queryClient.getQueryData(VIEWER)).toBeUndefined();
    expect(queryClient.getQueryData(meQueryKey)).toBeUndefined();
  });

  it('goes on signing out when a beforeSignOut hook fails or takes too long', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const server = fakeAuthServer(meFor(), {
      'POST /api/auth/sign-out': () => json(200, { ok: true }),
    });
    const queryClient = signedInDevice();
    const navigate = vi.fn();
    const queue = vi.fn();

    await signOut({
      queryClient,
      navigate,
      beforeHooks: [
        { id: 'push', run: () => Promise.reject(new Error('push')) },
        { id: 'stuck', run: () => new Promise<void>(() => undefined) },
      ],
      hooks: [{ id: 'queue', run: queue }],
      hookTimeoutMs: 20,
    });

    expect(changes(server)).toEqual(['POST /api/auth/sign-out']);
    expect(queue).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/sign-in', { replace: true });
    expect(error).toHaveBeenCalledWith('Sign-out step "push" failed.', expect.any(Error));
    expect(error).toHaveBeenCalledWith('Sign-out went on without waiting longer for: stuck.');
  });

  it("stops after beforeSignOut when the server can't be told, and says why", async () => {
    const server = fakeAuthServer(meFor(), {
      'POST /api/auth/sign-out': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const queryClient = signedInDevice();
    const navigate = vi.fn();
    const before = vi.fn();
    const hook = vi.fn();

    const failure = await signOut({
      queryClient,
      navigate,
      beforeHooks: [{ id: 'push', run: before }],
      hooks: [{ id: 'queue', run: hook }],
    })
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(0);
    expect(changes(server)).toEqual(['POST /api/auth/sign-out']);
    expect(before).toHaveBeenCalledTimes(1);
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
    const before = vi.fn();
    await Promise.all([
      signOut({ queryClient, navigate, beforeHooks: [{ id: 'push', run: before }], hooks: [] }),
      signOut({ queryClient, navigate, beforeHooks: [{ id: 'push', run: before }], hooks: [] }),
    ]);
    expect(changes(server)).toEqual(['POST /api/auth/sign-out']);
    expect(before).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('gives the hooks no person when none was loaded', async () => {
    fakeAuthServer(null, { 'POST /api/auth/sign-out': () => json(200, { ok: true }) });
    const before = vi.fn();
    const hook = vi.fn();
    await signOut({
      queryClient: createTestQueryClient(),
      navigate: () => undefined,
      beforeHooks: [{ id: 'push', run: before }],
      hooks: [{ id: 'queue', run: hook }],
    });
    expect(before).toHaveBeenCalledWith({ api, user: null });
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
    expect(error).toHaveBeenCalledWith('Sign-out went on without waiting longer for: stuck.');
  });
});
