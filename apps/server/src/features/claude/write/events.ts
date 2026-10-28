// The event writing help emits (decision 0007, section 2.4). IDs and small facts, never text.
import type { WriteAction, WritePlacement } from '@carehub/extras/claude/write';

/**
 * Someone put Claude's answer in a page with Replace or Insert below. The edit itself came through
 * the editor like typing; page history uses this to show "Avery Lin (with Claude)".
 */
export type ClaudeWriteAppliedEvent = {
  workspaceId: string;
  pageId: string;
  /** The person who accepted the answer. */
  by: string;
  action: WriteAction;
  placement: WritePlacement;
};

declare module '../../../core/events' {
  interface CareHubEvents {
    'claude.write.applied': ClaudeWriteAppliedEvent;
  }
}
