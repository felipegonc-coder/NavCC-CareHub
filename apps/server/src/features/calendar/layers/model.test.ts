import { describe, expect, it } from 'vitest';
import { BUILT_INS, layerJson, patched, withDefaults, type StoredLayer } from './model';

const meetings = (changes: Partial<StoredLayer>): StoredLayer => ({
  id: 'meetings',
  kind: 'meetings',
  color: 'purple',
  on: true,
  order: 1,
  ...changes,
});

describe('layers', () => {
  it('shows My events and Meetings with their defaults when nothing is saved', () => {
    expect(withDefaults([])).toEqual([
      { id: 'my-events', kind: 'my-events', color: 'blue', on: true, order: 0 },
      { id: 'meetings', kind: 'meetings', color: 'purple', on: true, order: 1 },
    ]);
  });

  it("uses the person's saved settings and order", () => {
    const saved = [{ ...BUILT_INS[0]!, order: 5 }, meetings({ color: 'green', on: false })];
    expect(withDefaults(saved).map(({ id, color, on }) => ({ id, color, on }))).toEqual([
      { id: 'meetings', color: 'green', on: false },
      { id: 'my-events', color: 'blue', on: true },
    ]);
  });

  it('keeps the built-in order when two layers share a place', () => {
    expect(withDefaults([meetings({ order: 0 })]).map((layer) => layer.id)).toEqual([
      'my-events',
      'meetings',
    ]);
  });

  it('adds Learning after Meetings while Learning is on in the workspace', () => {
    const learning: StoredLayer = {
      id: 'learning',
      kind: 'learning',
      color: 'green',
      on: true,
      order: 2,
    };
    expect(withDefaults([], true).at(-1)).toEqual(learning);
    const saved: StoredLayer = { ...learning, on: false };
    expect(withDefaults([saved], true).at(-1)).toEqual(saved);
    expect(withDefaults([saved]).map((layer) => layer.id)).toEqual(['my-events', 'meetings']);
  });

  it('leaves out rows that are not built-in layers', () => {
    const row: StoredLayer = { id: 'db-1', kind: 'database', color: 'red', on: true, order: 2 };
    expect(withDefaults([row]).map((layer) => layer.id)).toEqual(['my-events', 'meetings']);
  });

  it('changes only the fields sent', () => {
    expect(patched(meetings({ color: 'green' }), { on: false })).toEqual(
      meetings({ color: 'green', on: false }),
    );
    expect(patched(meetings({}), { order: 3, color: 'red' })).toEqual(
      meetings({ order: 3, color: 'red' }),
    );
  });

  it('answers with the layer name and no error', () => {
    expect(layerJson(meetings({ on: false }))).toEqual({
      id: 'meetings',
      kind: 'meetings',
      name: 'Meetings',
      color: 'purple',
      on: false,
      order: 1,
      status: 'ok',
      error: null,
      database: null,
      connectionId: null,
    });
    expect(layerJson(BUILT_INS[0]!).name).toBe('My events');
  });
});
