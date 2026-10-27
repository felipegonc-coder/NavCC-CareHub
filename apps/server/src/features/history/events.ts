// The events history emits (decision 0007, section 2.4), after the database commit.

/** A version was restored. `versionId` is the version saved just before the restore. */
export type VersionRestoredEvent = {
  pageId: string;
  workspaceId: string;
  versionId: string;
  restoredVersionId: string;
  by: string;
};

/** The nightly clean-up deleted unnamed versions (Data settings records each clean-up). */
export type VersionsCleanedEvent = { workspaceId: string; deleted: number; at: string };

declare module '../../core/events' {
  interface CareHubEvents {
    'history.version.restored': VersionRestoredEvent;
    'history.versions.cleaned': VersionsCleanedEvent;
  }
}
