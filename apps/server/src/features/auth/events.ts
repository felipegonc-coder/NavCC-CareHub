import type { FastifyInstance } from 'fastify';

// Accounts' events (decision 0007, section 2.4).
declare module '../../core/events' {
  interface CareHubEvents {
    /**
     * A session ended: sign-out, sign-out everywhere, a password change or a new sign-in in the
     * same browser. For data tied to one device (push subscriptions) and open connections
     * (co-editing, live updates).
     */
    'session.ended': EndedSession;
  }
}

export interface EndedSession {
  sessionId: string;
  userId: string;
}

/** `session.ended` for each one. Call after the commit. */
export function emitSessionsEnded(app: FastifyInstance, ended: readonly EndedSession[]): void {
  for (const session of ended) app.events.emit('session.ended', session);
}
