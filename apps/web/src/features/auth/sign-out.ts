import type { MeResponse } from '@carehub/shared';
import type { QueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { slots, type SignOutContext, type SignOutHook } from '../../slots';
import { resetAppStart } from './app-start';
import { SIGN_OUT_API } from './config';
import { meQueryKey } from './me';
import { SIGN_IN_PATH } from './next';

/** How long sign-out waits for the signOut hooks before going on without them. */
export const SIGN_OUT_HOOK_TIMEOUT_MS = 3000;

/**
 * Runs the signOut hooks side by side and waits for them, `timeoutMs` at most. A hook that fails
 * or is still running then is logged; this never throws.
 */
export async function runSignOutHooks(
  hooks: readonly SignOutHook[],
  ctx: SignOutContext,
  timeoutMs = SIGN_OUT_HOOK_TIMEOUT_MS,
): Promise<void> {
  if (hooks.length === 0) return;
  const running = new Set(hooks.map((hook) => hook.id));
  const all = Promise.all(
    hooks.map(async (hook) => {
      try {
        await hook.run(ctx);
      } catch (error) {
        console.error(`Sign-out step "${hook.id}" failed.`, error);
      } finally {
        running.delete(hook.id);
      }
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([all, timeout]);
  clearTimeout(timer);
  if (running.size > 0) {
    console.error(`Signed out without waiting longer for: ${[...running].join(', ')}.`);
  }
}

export interface SignOutOptions {
  queryClient: QueryClient;
  /** Opens the sign-in screen at the end. */
  navigate(to: string, options: { replace: boolean }): void;
  /** Every feature's `slots.signOut` unless given. */
  hooks?: readonly SignOutHook[];
  hookTimeoutMs?: number;
}

let current: Promise<void> | null = null;

/**
 * Signs out on this device: ends the session on the server, runs the signOut hooks, clears every
 * cached query so the next person on this device never sees them, and opens the sign-in screen.
 * When the server can't be told, it throws the ApiError and nothing else happens: the person stays
 * signed in, with their offline work kept. A second call while one runs gets the same promise.
 */
export function signOut(options: SignOutOptions): Promise<void> {
  current ??= endSession(options).finally(() => {
    current = null;
  });
  return current;
}

async function endSession({
  queryClient,
  navigate,
  hooks = slots.signOut,
  hookTimeoutMs,
}: SignOutOptions): Promise<void> {
  const user = queryClient.getQueryData<MeResponse | null>(meQueryKey)?.user ?? null;
  await api.post(SIGN_OUT_API);
  await runSignOutHooks(hooks, { user }, hookTimeoutMs);
  resetAppStart();
  queryClient.clear();
  navigate(SIGN_IN_PATH, { replace: true });
}
