// Property access for a query across databases (W2-3), with no database calls: which properties of
// the query's database and of the related ones a viewer sees, what formulas and rollups read (for
// the view engine's canSeeProperty and dependsOn), and which relations a query has to load.
import type { Id, Property } from '@carehub/databases';
import { canSeeProperty, type PropertyViewer } from '@carehub/databases/access';
import { visiblePropertyIds } from '@carehub/databases/engine';
import { formulaDependencies } from '@carehub/databases/formula';

/** One database as this viewer may see it. */
export interface DatabaseSchema {
  id: Id;
  /** Every property, as saved. */
  properties: readonly Property[];
  visible: ReadonlySet<Id>;
  /** The visible properties, in database order. */
  shown: readonly Property[];
}

/** The query's database and the ones it relates to, with property access for one viewer. */
export interface Schemas {
  home: DatabaseSchema;
  /** The query's database and the related ones that could be read. */
  byId: ReadonlyMap<Id, DatabaseSchema>;
  /** A property of any of them, and the database it belongs to. */
  property(propertyId: Id): { property: Property; databaseId: Id } | undefined;
  /** The engine's canSeeProperty: the see list (a property that no longer exists hides nothing). */
  canSee(propertyId: Id): boolean;
  /** The engine's dependsOn: what a formula reads, or a rollup's relation and target. */
  dependsOn(propertyId: Id): readonly Id[];
  /** Relations whose links are loaded: the visible ones here, and every one formulas and rollups read. */
  followed: ReadonlySet<Id>;
}

/** The ids in a relation cell (empty or malformed: none). */
export const linkIds = (value: unknown): Id[] =>
  Array.isArray(value) ? value.filter((x): x is Id => typeof x === 'string' && x !== '') : [];

/** The databases these properties relate to. */
export const relationTargets = (properties: readonly Property[]): Id[] =>
  properties.flatMap((p) => (p.config.type === 'relation' ? [p.config.targetDatabaseId] : []));

/**
 * Property access for one viewer over the query's database (`homeId`) and the related databases
 * given (database id → properties): canSeeProperty for each, and the engine's rule that formulas
 * and rollups reading anything hidden, here or elsewhere, are hidden too.
 */
export function schemasFor(
  homeId: Id,
  databases: ReadonlyMap<Id, readonly Property[]>,
  viewer: PropertyViewer,
): Schemas {
  const owners = new Map<Id, { property: Property; databaseId: Id }>();
  for (const [databaseId, properties] of databases) {
    for (const property of properties) owners.set(property.id, { property, databaseId });
  }
  const canSee = (id: Id): boolean => {
    const p = owners.get(id)?.property;
    return !p || canSeeProperty(p, viewer);
  };
  const reads = new Map<Id, readonly Id[]>();
  const dependsOn = (id: Id): readonly Id[] => {
    let out = reads.get(id);
    if (out) return out;
    const config = owners.get(id)?.property.config;
    if (config?.type === 'rollup') out = [config.relationPropertyId, config.targetPropertyId];
    else if (config?.type === 'formula') {
      const deps = formulaDependencies(config.expression);
      out = [...deps.local, ...deps.related.flatMap((r) => [r.relationPropertyId, r.propertyId])];
    } else out = [];
    reads.set(id, out);
    return out;
  };

  const byId = new Map<Id, DatabaseSchema>();
  for (const [id, properties] of databases) {
    const visible = visiblePropertyIds(properties, canSee, dependsOn);
    byId.set(id, { id, properties, visible, shown: properties.filter((p) => visible.has(p.id)) });
  }
  const home = byId.get(homeId) ?? { id: homeId, properties: [], visible: new Set(), shown: [] };
  if (!byId.has(homeId)) byId.set(homeId, home);

  // Relations to load: the visible ones here (their cells show titles), and every relation a
  // visible formula or rollup reads, through any chain of formulas and rollups elsewhere.
  const followed = new Set<Id>();
  const seen = new Set<Id>();
  const stack: Id[] = [];
  for (const p of home.shown) {
    if (p.config.type === 'relation') followed.add(p.id);
    if (p.config.type === 'formula' || p.config.type === 'rollup') stack.push(p.id);
  }
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const read of dependsOn(id)) {
      const type = owners.get(read)?.property.config.type;
      if (type === 'relation') followed.add(read);
      if (type === 'formula' || type === 'rollup') stack.push(read);
    }
  }
  return { home, byId, property: (id) => owners.get(id), canSee, dependsOn, followed };
}
