/**
 * Imports started from the dialog, by database. The import runs on the server and the person can
 * keep working, so closing the dialog doesn't stop it: opening Import CSV again picks it back up.
 */
import type { Id } from '@carehub/databases';
import type { ImportStarted } from './import-model';

export interface StartedImport extends ImportStarted {
  fileName: string;
}

const started = new Map<Id, StartedImport>();

export const startedImport = (databaseId: Id): StartedImport | null =>
  started.get(databaseId) ?? null;

export function rememberImport(databaseId: Id, value: StartedImport): void {
  started.set(databaseId, value);
}

export function forgetImport(databaseId: Id): void {
  started.delete(databaseId);
}
