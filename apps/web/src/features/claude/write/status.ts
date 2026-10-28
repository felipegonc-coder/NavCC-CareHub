// Whether writing help is offered to the person signed in: its switch is on (with the key and
// "Approved for this workspace" ticked) and they may Use Claude (Claude features spec, sections
// 3.1 and 5). Off until told otherwise, so nothing shows while it's unknown (CL-01, CL-04). The
// Claude settings code keeps it up to date (it learns of a switch change within 5 seconds) by
// calling `setWritingHelpOn`.
import { useSyncExternalStore } from 'react';

let writingHelpOn = false;
const listeners = new Set<() => void>();

export function setWritingHelpOn(on: boolean): void {
  if (on === writingHelpOn) return;
  writingHelpOn = on;
  for (const listener of [...listeners]) listener();
}

/** For menus that check when they open, such as the selection toolbar and the "/" menu. */
export function isWritingHelpOn(): boolean {
  return writingHelpOn;
}

export function onWritingHelpChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The same, for components: they draw again when it changes, so an open box closes (CL-05). */
export function useWritingHelpOn(): boolean {
  return useSyncExternalStore(onWritingHelpChange, isWritingHelpOn, () => false);
}
