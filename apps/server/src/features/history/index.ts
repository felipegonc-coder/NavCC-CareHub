// What other features may use from history (docs/extras/history.md).
export { countExpiringVersions, nextCleanupAt, versionStorageBytes } from './retention';
export { recordUpdates } from './updates';
export { saveVersionNow } from './versions';
export type { VersionRestoredEvent, VersionsCleanedEvent } from './events';
export type { NewUpdate, UpdateDetails } from './updates';
export type { SavedVersion, SaveVersionOptions } from './versions';
export type { UpdateKind, VersionKind, VersionReason } from '@carehub/extras/history';
