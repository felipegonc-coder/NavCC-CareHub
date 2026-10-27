/** Moving entries: where a drop lands, keyboard reordering, and showing a move before the server
 *  answers. */
import { atLeast } from './access';
import { groupChildren, pathTo, subtreeIds, type TreeEntry } from './tree';
import type { TreeNode } from './types';

/**
 * Where a page goes: the top of a space or inside a page, at `index` among the siblings the
 * person sees there (the page itself not counted). No index means last.
 */
export interface MoveTo {
  spaceId?: string | undefined;
  parentId: string | null;
  index?: number | undefined;
}

/** A tree that takes drops: its space, and whether the person may add pages at its top. */
export interface MoveScope {
  spaceId: string;
  canAddTop: boolean;
}

export type DropPlace = 'before' | 'after' | 'inside';

/** The top and bottom quarters of a row drop beside it; the middle drops inside a page. */
export function dropPlace(
  rect: { top: number; height: number },
  y: number,
  canHold: boolean,
): DropPlace {
  const at = rect.height > 0 ? (y - rect.top) / rect.height : 0.5;
  if (!canHold) return at < 0.5 ? 'before' : 'after';
  if (at < 0.25) return 'before';
  return at > 0.75 ? 'after' : 'inside';
}

function findNode<T extends TreeEntry>(
  byParent: ReadonlyMap<string | null, readonly T[]>,
  id: string,
): T | undefined {
  for (const children of byParent.values()) {
    const node = children.find((child) => child.id === id);
    if (node) return node;
  }
  return undefined;
}

/** Whether the person may put pages at this level: Can edit on the parent, or the space allows. */
function canPlaceIn(
  byParent: ReadonlyMap<string | null, readonly TreeNode[]>,
  parentId: string | null,
  scope: MoveScope,
): boolean {
  if (parentId === null) return scope.canAddTop;
  const parent = findNode(byParent, parentId);
  return parent?.kind === 'page' && atLeast(parent.access, 'edit');
}

/** Where dropping `page` on `over` puts it, or null when it can't go there. */
export function dropTarget(
  byParent: ReadonlyMap<string | null, readonly TreeNode[]>,
  page: TreeNode,
  over: TreeNode,
  place: DropPlace,
  scope: MoveScope,
): MoveTo | null {
  const path = pathTo(byParent, over.id);
  if (over.id === page.id || !path || path.includes(page.id)) return null;
  if (place === 'inside') {
    return canPlaceIn(byParent, over.id, scope)
      ? { spaceId: scope.spaceId, parentId: over.id }
      : null;
  }
  const parentId = path[path.length - 1] ?? null;
  if (!canPlaceIn(byParent, parentId, scope)) return null;
  const siblings = (byParent.get(parentId) ?? []).filter((node) => node.id !== page.id);
  const index = siblings.findIndex((node) => node.id === over.id) + (place === 'after' ? 1 : 0);
  return { spaceId: scope.spaceId, parentId, index };
}

/** Ctrl+Shift+↑ or ↓: one place up or down among its siblings, or null at either end. */
export function stepTarget(
  byParent: ReadonlyMap<string | null, readonly TreeNode[]>,
  page: TreeNode,
  step: 1 | -1,
  scope: MoveScope,
): MoveTo | null {
  const path = pathTo(byParent, page.id) ?? [];
  const parentId = path[path.length - 1] ?? null;
  const siblings = byParent.get(parentId) ?? [];
  const index = siblings.findIndex((node) => node.id === page.id) + step;
  if (index < 0 || index >= siblings.length || !canPlaceIn(byParent, parentId, scope)) return null;
  return { spaceId: scope.spaceId, parentId, index };
}

/**
 * The entries with `id` moved, so the move shows before the server answers. Its new siblings get
 * stand-in positions in their new order; the next load brings the real ones.
 */
export function applyMove<T extends TreeEntry>(nodes: readonly T[], id: string, to: MoveTo): T[] {
  const page = nodes.find((node) => node.id === id);
  if (!page) return [...nodes];
  const siblings = groupChildren(nodes.filter((node) => node.id !== id)).get(to.parentId) ?? [];
  const at = Math.min(Math.max(to.index ?? siblings.length, 0), siblings.length);
  const order = [...siblings.slice(0, at), page, ...siblings.slice(at)];
  const positions = new Map(order.map((node, index) => [node.id, String(index).padStart(6, '0')]));
  return nodes.map((node) => {
    const position = positions.get(node.id) ?? node.position;
    if (node.id === id) return { ...node, parentId: to.parentId, position };
    return position === node.position ? node : { ...node, position };
  });
}

/**
 * Space trees (by space ID) after a move, for the cached trees only. The page goes with
 * everything under it, also into another space.
 */
export function movedTrees(
  trees: ReadonlyMap<string, readonly TreeNode[]>,
  id: string,
  to: MoveTo,
): Map<string, TreeNode[]> {
  const source = [...trees.values()].find((nodes) => nodes.some((node) => node.id === id)) ?? [];
  const moving = subtreeIds(source, id);
  const carried = source.filter((node) => moving.has(node.id));
  const target =
    to.spaceId ??
    [...trees].find(([, nodes]) => nodes.some((node) => node.id === to.parentId))?.[0];
  const out = new Map<string, TreeNode[]>();
  for (const [spaceId, nodes] of trees) {
    const rest = nodes.filter((node) => !moving.has(node.id));
    out.set(spaceId, spaceId === target ? applyMove([...rest, ...carried], id, to) : rest);
  }
  return out;
}
