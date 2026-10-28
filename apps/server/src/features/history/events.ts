// The events history emits (decision 0007, section 2.4), after the database commit.

/** A version was restored. `versionId` is the version saved just before the restore. */
export type VersionRestoredEvent = {
  pageId: string;
  workspaceId: string;
  versionId: string;
  restoredVersionId: string;
  by: string;
};

declare module '../../core/events' {
  interface CareHubEvents {
    'history.version.restored': VersionRestoredEvent;
  }
}
