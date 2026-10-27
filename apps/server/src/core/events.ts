import type { FastifyBaseLogger, FastifyInstance } from 'fastify';

/**
 * Every event name with its payload. A feature adds its own events by declaration merging, in a
 * file in its own folder:
 *
 * ```ts
 * declare module '../../core/events' {
 *   interface CareHubEvents {
 *     'page.created': { pageId: string; workspaceId: string; by: string };
 *   }
 * }
 * ```
 *
 * Names are `<feature>.<thing>.<verb>` (or the short core names in decision 0007, section 2.4).
 * Payloads are IDs plus small facts, never secrets or content. Emit only after the database commit.
 *
 * An event says something happened, not who may see it. A handler that shows or sends anything to
 * people (a notice, a push, a live update) checks each recipient's access when it delivers, and
 * skips anyone who can't see the page or item now.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CareHubEvents {}

export type EventHandler<Payload> = (payload: Payload) => void | Promise<void>;

export interface EventBus<Events> {
  /** Runs every handler of `name` asynchronously, after this returns. Never throws. */
  emit<Name extends keyof Events & string>(name: Name, payload: Events[Name]): void;
  /** Adds a handler and returns a function that removes it. */
  on<Name extends keyof Events & string>(
    name: Name,
    handler: EventHandler<Events[Name]>,
  ): () => void;
  /** Resolves once every handler started so far has finished (for shutdown and tests). */
  settled(): Promise<void>;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** In-process events between features. */
    events: EventBus<CareHubEvents>;
  }
}

/** An event bus whose failing handlers are logged with `log` and never reach the emitter. */
export function createEventBus<Events>(log: Pick<FastifyBaseLogger, 'error'>): EventBus<Events> {
  const handlers = new Map<string, Set<EventHandler<unknown>>>();
  const running = new Set<Promise<void>>();

  return {
    emit(name, payload) {
      for (const handler of handlers.get(name) ?? []) {
        const run: Promise<void> = new Promise((resolve) => setImmediate(resolve))
          .then(() => handler(payload))
          .catch((err: unknown) => log.error({ err, event: name }, 'event handler failed'))
          .finally(() => running.delete(run));
        running.add(run);
      }
    },
    on(name, handler) {
      const forName = handlers.get(name) ?? new Set();
      handlers.set(name, forName);
      forName.add(handler as EventHandler<unknown>);
      return () => {
        forName.delete(handler as EventHandler<unknown>);
      };
    },
    async settled() {
      // Handlers may emit more events, so wait until nothing is left running.
      while (running.size > 0) await Promise.all(running);
    },
  };
}

/** Adds `app.events`. buildApp also waits for running handlers when the app closes. */
export function registerEvents(app: FastifyInstance): void {
  app.decorate('events', createEventBus<CareHubEvents>(app.log));
}
