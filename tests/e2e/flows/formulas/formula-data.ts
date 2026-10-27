import type { Property, PropertyConfig } from '../databases/database-api.js';

// A formula is a property whose settings hold the formula as stored: properties are referenced by
// id, prop("<property id>"), so renames don't break it (Formulas spec section 4; the Formula
// config in packages/databases/src/types.ts). The editor shows names instead.

/** What a formula gives, worked out when it's saved. */
export type ResultKind = 'number' | 'text' | 'boolean' | 'date';

/** A formula property's settings, such as formula(`${prop(score)} * 2`, 'number'). */
export function formula(expression: string, resultKind: ResultKind): PropertyConfig {
  return { type: 'formula', expression, resultKind, number: null };
}

/** A reference to a property, in the stored form. */
export function prop(property: Property): string {
  return `prop("${property.id}")`;
}
