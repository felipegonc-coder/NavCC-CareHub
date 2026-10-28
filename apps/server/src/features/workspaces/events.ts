// The workspace's events (decision 0007, section 2.4), after the database commit.

/** Someone was taken out of the workspace (their sessions have ended too). */
export type MemberRemovedEvent = { workspaceId: string; userId: string };

declare module '../../core/events' {
  interface CareHubEvents {
    'member.removed': MemberRemovedEvent;
  }
}
