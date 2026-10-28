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

type BuiltInId = (typeof BUILT_IN_LAYERS)[keyof typeof BUILT_IN_LAYERS];

const builtIn = (id: BuiltInId, color: string, order: number): StoredLayer => ({
  id,
  kind: id,
  color,
  on: true,
  order,
});

/** The built-in layers everyone has, with their defaults. */
export const BUILT_INS: readonly StoredLayer[] = [
  builtIn(BUILT_IN_LAYERS.myEvents, 'blue', 0),
  builtIn(BUILT_IN_LAYERS.meetings, 'purple', 1),
];

/** Course due dates: a built-in layer while Learning is on for the workspace. */
export const LEARNING_LAYER = builtIn(BUILT_IN_LAYERS.learning, 'green', 2);

/** The built-in layers in a workspace, with Learning's when it's on there. */
export const builtInsFor = (learning: boolean): readonly StoredLayer[] =>
  learning ? [...BUILT_INS, LEARNING_LAYER] : BUILT_INS;

const NAMES: Readonly<Record<string, string>> = {
  [BUILT_IN_LAYERS.myEvents]: 'My events',
  [BUILT_IN_LAYERS.meetings]: 'Meetings',
  [BUILT_IN_LAYERS.learning]: 'Learning',
};

/** The built-in layers with the person's own settings on top, in their order. */
export function withDefaults(rows: readonly StoredLayer[], learning = false): StoredLayer[] {
  const layers = builtInsFor(learning);
  const saved = new Map(rows.map((row) => [row.id, row]));
  const rank = (layer: StoredLayer) => layers.findIndex((each) => each.id === layer.id);
  return layers
    .map((layer) => saved.get(layer.id) ?? layer)
    .sort((a, b) => a.order - b.order || rank(a) - rank(b));
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
