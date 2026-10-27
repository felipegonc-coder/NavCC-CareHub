import { CLAUDE_FEATURES, type ClaudeFeature } from '@carehub/extras/claude';
import type { ClaudeStatus } from '@carehub/extras/claude/settings';
import { useSyncExternalStore } from 'react';

// Which Claude features the person signed in can use now: the key, Nav's OK, the feature's switch
// and Use Claude (Claude features spec, sections 3.1 and 5). Everything is off until the server
// says otherwise, so no Claude entry point shows while it's unknown (CL-01, CL-04). StatusSync
// asks every 5 seconds, so a feature switched off goes away within 5 seconds (CL-05).

export const ALL_OFF: ClaudeStatus = {
  on: Object.fromEntries(CLAUDE_FEATURES.map((feature) => [feature, false])) as ClaudeStatus['on'],
};

let status: ClaudeStatus = ALL_OFF;
const listeners = new Set<(status: ClaudeStatus) => void>();

const same = (a: ClaudeStatus, b: ClaudeStatus) =>
  CLAUDE_FEATURES.every((feature) => a.on[feature] === b.on[feature]);

/** Called by StatusSync (and tests). Listeners hear each change once. */
export function setClaudeStatus(next: ClaudeStatus): void {
  if (same(status, next)) return;
  status = { on: { ...next.on } };
  for (const listener of [...listeners]) listener(status);
}

export function claudeStatus(): ClaudeStatus {
  return status;
}

/** For menus that check when they open, such as the selection toolbar and the "/" menu. */
export function isClaudeOn(feature: ClaudeFeature): boolean {
  return status.on[feature];
}

/**
 * Hears every change, for example writing help:
 * `onClaudeStatusChange((now) => setWritingHelpOn(now.on.writing_help))`.
 */
export function onClaudeStatusChange(listener: (status: ClaudeStatus) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The same, for components: they draw again when the feature turns on or off. */
export function useClaudeOn(feature: ClaudeFeature): boolean {
  return useSyncExternalStore(
    onClaudeStatusChange,
    () => status.on[feature],
    () => false,
  );
}
