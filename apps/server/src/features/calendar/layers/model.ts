import { BUILT_IN_LAYERS, type Layer, type LayerPatch } from '@carehub/team-calendar-api';

/** The layer kinds Calendar stores itself. Connected calendars are the sync part's. */
export type StoredKind = 'my-events' | 'meetings' | 'learning' | 'database';

/** One person's settings for one layer, as stored. */
export type StoredLayer = {
  id: string;
  kind: StoredKind;
  color: string;
  on: boolean;
  order: number;
};

const builtIn = (id: 'my-events' | 'meetings', color: string, order: number): StoredLayer => ({
  id,
  kind: id,
  color,
  on: true,
  order,
});

/** The built-in layers everyone has, with their defaults. Learning due dates come in Phase 4. */
export const BUILT_INS: readonly StoredLayer[] = [
  builtIn(BUILT_IN_LAYERS.myEvents, 'blue', 0),
  builtIn(BUILT_IN_LAYERS.meetings, 'purple', 1),
];

const NAMES: Readonly<Record<string, string>> = {
  [BUILT_IN_LAYERS.myEvents]: 'My events',
  [BUILT_IN_LAYERS.meetings]: 'Meetings',
};

/** The built-in layers with the person's own settings on top, in their order. */
export function withDefaults(rows: readonly StoredLayer[]): StoredLayer[] {
  const saved = new Map(rows.map((row) => [row.id, row]));
  const rank = (layer: StoredLayer) => BUILT_INS.findIndex((each) => each.id === layer.id);
  return BUILT_INS.map((layer) => saved.get(layer.id) ?? layer).sort(
    (a, b) => a.order - b.order || rank(a) - rank(b),
  );
}

/** A built-in layer's new settings after a change. */
export function patched(layer: StoredLayer, patch: LayerPatch): StoredLayer {
  return {
    ...layer,
    color: patch.color ?? layer.color,
    on: patch.on ?? layer.on,
    order: patch.order ?? layer.order,
  };
}

export function layerJson(layer: StoredLayer): Layer {
  return {
    id: layer.id,
    kind: layer.kind,
    name: NAMES[layer.id] ?? '',
    color: layer.color,
    on: layer.on,
    order: layer.order,
    status: 'ok',
    error: null,
    database: null,
    connectionId: null,
  };
}
