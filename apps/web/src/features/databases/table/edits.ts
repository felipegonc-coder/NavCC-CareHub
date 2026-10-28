import type { Id, Property, SelectOption } from '@carehub/databases';

/** Same stored value (both empty counts as the same). */
export const sameStored = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The property with these options added (later pasted values then find them by name). */
export function withOptions(property: Property, options: readonly SelectOption[]): Property {
  const config = property.config;
  if (config.type !== 'select' && config.type !== 'multi_select') return property;
  return { ...property, config: { ...config, options: [...config.options, ...options] } };
}

/** Typed options the property doesn't have yet (by id): they're added before the value is saved. */
export function missingOptions(
  property: Property | undefined,
  options: readonly SelectOption[] = [],
): SelectOption[] {
  const config = property?.config;
  if (config?.type !== 'select' && config?.type !== 'multi_select') return [];
  const have = new Set(config.options.map((o) => o.id));
  return options.filter((o) => !have.has(o.id));
}

/**
 * A Select or Multi-select value with the ids addOptions saved: a typed option whose name the
 * property already had is saved as that one (a Multi-select then keeps it once).
 */
export function withSavedOptions(value: unknown, saved: Readonly<Record<Id, Id>>): unknown {
  const savedId = (id: unknown) => (typeof id === 'string' ? (saved[id] ?? id) : id);
  if (typeof value === 'string') return savedId(value);
  return Array.isArray(value) ? [...new Set(value.map(savedId))] : value;
}

/** Whether a Select or Multi-select value names any of these options. */
export function usesOptions(value: unknown, ids: ReadonlySet<Id>): boolean {
  if (typeof value === 'string') return ids.has(value);
  return Array.isArray(value) && value.some((id) => typeof id === 'string' && ids.has(id));
}
