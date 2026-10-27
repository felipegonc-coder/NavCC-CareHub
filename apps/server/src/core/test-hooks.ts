// The switch for test hooks: routes under /api/<feature>/test/ that the browser tests use to set
// things up or run a job now (decision 0007, section 2.5). Turned on with CAREHUB_TEST_HOOKS=1, which
// config.ts accepts only when the server can be reached from this computer alone.
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    /** Whether the test hooks are on. A feature registers its `/test/` routes only then. */
    testHooks: boolean;
  }
}

const TEST_HOOK_ROUTE = /^\/api\/[^/]+\/test\//i;

/** Whether `url` is a test hook: `/api/<feature>/test/...`. (`/api/push/test` isn't one.) */
export function isTestHookRoute(url: string): boolean {
  return TEST_HOOK_ROUTE.test(url);
}

/**
 * Sets `app.testHooks` and stops start-up when a test hook is registered while they're off, or as a
 * public route: each hook is an ordinary route that needs a session, the CSRF header and permissions.
 */
export function registerTestHooks(app: FastifyInstance, enabled: boolean): void {
  app.decorate('testHooks', enabled);
  if (enabled) {
    app.log.warn('The test hooks are on (CAREHUB_TEST_HOOKS=1). Never use them with real data.');
  }
  app.addHook('onRoute', (route) => {
    if (!isTestHookRoute(route.url)) return;
    if (!enabled) {
      throw new Error(`${route.url} is a test hook: register it only when app.testHooks is true.`);
    }
    if (route.config?.public) {
      throw new Error(`${route.url} is a test hook, so it can't be public.`);
    }
  });
}
