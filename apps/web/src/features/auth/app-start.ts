import type { AppStart, AppStartContext } from '../../slots';

// Who the appStart items last ran for. Kept outside React, so they run once per sign-in, not again
// each time RequireAuth mounts (after a signed-out screen such as /design, say).
let startedFor: string | null = null;

/**
 * Runs each appStart item once for the person signed in, without waiting for any. A failing item
 * is logged and the rest still run.
 */
export function startApp(items: readonly AppStart[], ctx: AppStartContext): void {
  if (startedFor === ctx.user.id) return;
  startedFor = ctx.user.id;
  for (const item of items) {
    void Promise.resolve()
      .then(() => item.run(ctx))
      .catch((error: unknown) => console.error(`App start "${item.id}" failed.`, error));
  }
}

/** Lets the appStart items run again at the next sign-in. Sign-in and sign-out call it. */
export function resetAppStart(): void {
  startedFor = null;
}
