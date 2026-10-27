import type { AnyExtension } from '@tiptap/core';
import { nodes as claude } from './claude';
import { nodes as databases } from './databases';
import { nodes as forms } from './forms';
import { nodes as learning } from './learning';
import { nodes as meetings } from './meetings';

/*
 * Lane blocks share one schema: every editor and the collab server load all of them, so no client
 * deletes a block it doesn't know. Each lane owns only its lanes/<lane>.ts; core owns this file.
 *
 * - Schema only: Node.create (or Mark.create) with name, attributes, group, atom or content,
 *   parseHTML and renderHTML. Import only from @tiptap/core or @tiptap/pm, never React or app code.
 * - The React view goes in the web `editor` slot's `nodeViews`. A block without one shows
 *   "This block needs <feature>." and is kept.
 * - Never rename or remove a node or attribute once it is on main.
 */
export const laneNodesByFeature = {
  databases, // feature: databases
  forms, // feature: forms
  meetings, // feature: meetings
  learning, // feature: learning
  claude, // feature: claude
} satisfies Record<string, AnyExtension[]>;

export const laneNodes: AnyExtension[] = Object.values(laneNodesByFeature).flat();

/** The feature a lane node belongs to, like "Databases"; undefined for core nodes. */
export function laneFeature(name: string): string | undefined {
  for (const [feature, nodes] of Object.entries(laneNodesByFeature)) {
    if (nodes.some((node) => node.name === name)) {
      return feature.charAt(0).toUpperCase() + feature.slice(1);
    }
  }
  return undefined;
}
