// Whether the assistant panel is offered to the person signed in: the Assistant switch is on (with
// the key and "Nav has given the OK" ticked) and they may Use Claude (Claude features spec,
// sections 3.1, 3.3 and 5). Off until told otherwise, so nothing shows while it's unknown (CL-01,
// CL-04). The Claude settings code keeps it in step (within 5 seconds of a switch change, CL-05)
// by calling `setAssistantOn`.
import { useSyncExternalStore } from 'react';

let assistantOn = false;
const listeners = new Set<() => void>();

export function setAssistantOn(on: boolean): void {
  if (on === assistantOn) return;
  assistantOn = on;
  for (const listener of [...listeners]) listener();
}

export function isAssistantOn(): boolean {
  return assistantOn;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** For components: they draw again when it changes, so an open panel goes away (CL-05). */
export function useAssistantOn(): boolean {
  return useSyncExternalStore(subscribe, isAssistantOn, () => false);
}
