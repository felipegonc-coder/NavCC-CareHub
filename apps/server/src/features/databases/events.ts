// Database events (decision 0200), sent through app.events after the commit: IDs and small facts
// only, never values or titles. Team tools' automations and analytics listen with onDatabaseEvent
// (every database event) or app.events.on (one name).
import type { FastifyInstance } from 'fastify';

/** What made or changed a row. */
export type RowSource = 'user' | 'import' | 'form' | 'automation' | 'button' | 'template';

export interface RowCreatedEvent {
  workspaceId: string;
  databaseId: string;
  rowId: string;
  /** null for an anonymous form answer. */
  actorId: string | null;
  source: RowSource;
  /** The form (view id) that made the row. */
  formId?: string;
  responseId?: string;
}

export interface RowUpdatedEvent {
  workspaceId: string;
  databaseId: string;
  rowId: string;
  actorId: string | null;
  /** The properties whose values changed; the Name property's id when the row was renamed. */
  propertyIds: string[];
  source: RowSource;
}

/** databases.row.trashed and databases.row.restored. */
export interface RowsMovedEvent {
  workspaceId: string;
  databaseId: string;
  rowIds: string[];
  actorId: string;
}

export interface DatabaseViewedEvent {
  workspaceId: string;
  databaseId: string;
  viewId: string;
  userId: string;
}

export interface DatabaseUpdatedEvent {
  workspaceId: string;
  databaseId: string;
  actorId: string;
  /** Which settings changed, such as 'properties' or 'views'. */
  what: string;
}

/** Every database event name with its payload. */
export interface DatabaseEvents {
  'databases.row.created': RowCreatedEvent;
  'databases.row.updated': RowUpdatedEvent;
  'databases.row.trashed': RowsMovedEvent;
  'databases.row.restored': RowsMovedEvent;
  'databases.database.viewed': DatabaseViewedEvent;
  'databases.database.updated': DatabaseUpdatedEvent;
}

declare module '../../core/events' {
  interface CareHubEvents {
    'databases.row.created': RowCreatedEvent;
    'databases.row.updated': RowUpdatedEvent;
    'databases.row.trashed': RowsMovedEvent;
    'databases.row.restored': RowsMovedEvent;
    'databases.database.viewed': DatabaseViewedEvent;
    'databases.database.updated': DatabaseUpdatedEvent;
  }
}

export type DatabaseEventName = keyof DatabaseEvents;

export const DATABASE_EVENTS = {
  rowCreated: 'databases.row.created',
  rowUpdated: 'databases.row.updated',
  rowTrashed: 'databases.row.trashed',
  rowRestored: 'databases.row.restored',
  databaseViewed: 'databases.database.viewed',
  databaseUpdated: 'databases.database.updated',
} as const satisfies Record<string, DatabaseEventName>;

const NAMES: readonly DatabaseEventName[] = Object.values(DATABASE_EVENTS);

/** One database event, as onDatabaseEvent hands it over. */
export type DatabaseEvent = {
  [Name in DatabaseEventName]: { name: Name; payload: DatabaseEvents[Name] };
}[DatabaseEventName];

/**
 * Calls `handler` with every database event, after the commit that made it. Returns a function
 * that stops listening. A failing handler is logged by app.events and never reaches the sender.
 */
export function onDatabaseEvent(
  app: Pick<FastifyInstance, 'events'>,
  handler: (event: DatabaseEvent) => void | Promise<void>,
): () => void {
  const stops = NAMES.map((name) =>
    app.events.on(name, (payload) => handler({ name, payload } as DatabaseEvent)),
  );
  return () => stops.forEach((stop) => stop());
}
