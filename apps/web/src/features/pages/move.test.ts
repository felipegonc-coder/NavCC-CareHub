import { describe, expect, it } from 'vitest';
import {
  applyMove,
  dropPlace,
  dropTarget,
  movedTrees,
  movePlaces,
  stepTarget,
  type MoveScope,
} from './move';
import { groupChildren } from './tree';
import type { Space, TreeNode } from './types';

const node = (id: string, parentId: string | null, more: Partial<TreeNode> = {}): TreeNode => ({
  id,
  parentId,
  kind: 'page',
  title: id,
  icon: null,
  position: id,
  hasChildren: false,
  access: 'full',
  ...more,
});

// Fictional General space; its top level in order: Onboarding (Week 1 > Day 1), a read-only
// Policies page, Refunds and a Rota database.
const general = [
  node('onboarding', null),
  node('week1', 'onboarding'),
  node('day1', 'week1'),
  node('refunds', null),
  node('rota', null, { kind: 'database' }),
  node('policies', null, { access: 'view' }),
];
const byParent = groupChildren(general);
const scope: MoveScope = { spaceId: 'general', canAddTop: true };
const find = (id: string) => general.find((page) => page.id === id) as TreeNode;

describe('dropPlace', () => {
  const rect = { top: 100, height: 32 };
  it('drops above, inside or below by where the pointer is on the row', () => {
    expect(dropPlace(rect, 104, true)).toBe('before');
    expect(dropPlace(rect, 116, true)).toBe('inside');
    expect(dropPlace(rect, 130, true)).toBe('after');
  });

  it('only drops beside an entry that holds no pages', () => {
    expect(dropPlace(rect, 112, false)).toBe('before');
    expect(dropPlace(rect, 120, false)).toBe('after');
  });
});

describe('dropTarget', () => {
  it('puts the page before or after a sibling, counting siblings without the page', () => {
    expect(dropTarget(byParent, find('day1'), find('refunds'), 'before', scope)).toEqual({
      spaceId: 'general',
      parentId: null,
      index: 2,
    });
    // Onboarding is first, so without it Refunds is second and "after" means third.
    expect(dropTarget(byParent, find('onboarding'), find('refunds'), 'after', scope)).toEqual({
      spaceId: 'general',
      parentId: null,
      index: 2,
    });
  });

  it('puts the page inside another as its last sub-page', () => {
    expect(dropTarget(byParent, find('refunds'), find('week1'), 'inside', scope)).toEqual({
      spaceId: 'general',
      parentId: 'week1',
    });
  });

  it('refuses a drop onto the page itself or into what is under it', () => {
    expect(
      dropTarget(byParent, find('onboarding'), find('onboarding'), 'inside', scope),
    ).toBeNull();
    expect(dropTarget(byParent, find('onboarding'), find('day1'), 'inside', scope)).toBeNull();
    expect(dropTarget(byParent, find('onboarding'), find('day1'), 'before', scope)).toBeNull();
  });

  it('needs Can edit where the page goes', () => {
    expect(dropTarget(byParent, find('refunds'), find('policies'), 'inside', scope)).toBeNull();
    expect(dropTarget(byParent, find('refunds'), find('rota'), 'inside', scope)).toBeNull();
    const ownersOnly = { ...scope, canAddTop: false };
    expect(dropTarget(byParent, find('day1'), find('refunds'), 'before', ownersOnly)).toBeNull();
    expect(dropTarget(byParent, find('day1'), find('week1'), 'inside', ownersOnly)).not.toBeNull();
  });
});

describe('stepTarget', () => {
  it('moves one place up or down among siblings, and not past either end', () => {
    expect(stepTarget(byParent, find('refunds'), -1, scope)).toEqual({
      spaceId: 'general',
      parentId: null,
      index: 1,
    });
    expect(stepTarget(byParent, find('refunds'), 1, scope)).toMatchObject({ index: 3 });
    expect(stepTarget(byParent, find('onboarding'), -1, scope)).toBeNull();
    expect(stepTarget(byParent, find('week1'), 1, scope)).toBeNull();
  });
});

describe('applyMove', () => {
  const order = (nodes: TreeNode[], parentId: string | null) =>
    groupChildren(nodes)
      .get(parentId)
      ?.map((page) => page.id);

  it('shows the page in its new place at once', () => {
    const moved = applyMove(general, 'rota', { parentId: null, index: 0 });
    expect(order(moved, null)).toEqual(['rota', 'onboarding', 'policies', 'refunds']);
    const inside = applyMove(general, 'refunds', { parentId: 'onboarding' });
    expect(order(inside, 'onboarding')).toEqual(['week1', 'refunds']);
    expect(order(inside, null)).toEqual(['onboarding', 'policies', 'rota']);
  });
});

describe('movedTrees', () => {
  it('carries the page and its sub-pages into another space', () => {
    const trees = new Map([
      ['general', general],
      ['care', [node('handbook', null)]],
    ]);
    const out = movedTrees(trees, 'onboarding', { spaceId: 'care', parentId: 'handbook' });
    expect(out.get('general')?.map((page) => page.id)).toEqual(['refunds', 'rota', 'policies']);
    expect(out.get('care')?.map((page) => `${page.id}<${page.parentId}`)).toEqual([
      'handbook<null',
      'onboarding<handbook',
      'week1<onboarding',
      'day1<week1',
    ]);
  });
});

describe('movePlaces', () => {
  const spaces: Space[] = [
    { id: 'general', kind: 'open', name: 'General', icon: null },
    { id: 'board', kind: 'closed', name: 'Board', icon: null, canAddPages: false },
  ];

  it('lists spaces and pages the person can edit, without the page and what is under it', () => {
    const places = movePlaces(find('week1'), spaces, new Map([['general', general]]));
    expect(places.map((place) => `${place.title} (${place.path})`)).toEqual([
      'General ()',
      'onboarding (General)',
      'refunds (General)',
    ]);
    expect(places[1]?.to).toEqual({ spaceId: 'general', parentId: 'onboarding' });
  });
});
