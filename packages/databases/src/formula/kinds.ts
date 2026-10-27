/**
 * The formula types of properties and of saved result kinds, and a simple schema built from a
 * property list.
 */
import { computedKind } from '../computed';
import type { ComputedKind, Id, Property } from '../types';
import {
  BOOLEAN,
  DATE,
  EMPTY_TYPE,
  NUMBER,
  PERSON,
  TEXT,
  listType,
  type FormulaSchema,
  type FormulaType,
} from './registry';

/**
 * The type a formula sees for a property (`depth`: how many relations away its row is), or the
 * message when it can't be used. `related` gives the database a relation reaches.
 */
export function propertyType(
  prop: Property,
  schema: FormulaSchema,
  depth: number,
  related: (relationPropertyId: Id) => FormulaSchema | null,
): FormulaType | string {
  const c = prop.config;
  switch (c.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone':
    case 'select':
    case 'status':
      return TEXT;
    case 'number':
    case 'checklist':
      return NUMBER;
    case 'multi_select':
    case 'files':
      return listType(TEXT);
    case 'date':
    case 'created_time':
    case 'edited_time':
      return DATE;
    case 'checkbox':
      return BOOLEAN;
    case 'person':
      return listType(PERSON);
    case 'created_by':
    case 'edited_by':
      return PERSON;
    case 'relation':
      return listType({ kind: 'page', schema: related(prop.id), depth: depth + 1, via: prop.id });
    case 'unique_id':
      return c.prefix ? TEXT : NUMBER;
    case 'formula':
    case 'rollup':
      return schema.kindOf(prop) ?? `Property "${prop.name}" has an error.`;
    case 'button':
      return `Property "${prop.name}" is a button, which has no value.`;
  }
}

/** A formula type for a saved result kind; lists and rows from it don't know what they hold. */
export function fromComputedKind(kind: ComputedKind | null): FormulaType | null {
  switch (kind) {
    case null:
      return null;
    case 'number':
      return NUMBER;
    case 'text':
      return TEXT;
    case 'boolean':
      return BOOLEAN;
    case 'date':
      return DATE;
    case 'person':
      return PERSON;
    case 'page':
      return { kind: 'page', schema: null, depth: 1, via: null };
    case 'list':
      return listType(EMPTY_TYPE);
  }
}

/** The type a formula or rollup property gives, from its saved result kind. */
export function defaultKindOf(prop: Property): FormulaType | null {
  return fromComputedKind(computedKind(prop));
}

/** The result kind to save for a formula of this type; null when it's always empty. */
export function resultKindOf(type: FormulaType): ComputedKind | null {
  return type.kind === 'empty' ? null : type.kind;
}

/** A schema from a property list; related databases come from `related` when given. */
export function basicSchema(
  properties: readonly Property[],
  related?: (relationPropertyId: Id) => FormulaSchema | null,
  deleted?: readonly { id: Id; name: string }[],
): FormulaSchema {
  const schema: FormulaSchema = {
    properties,
    related: (id) => related?.(id) ?? null,
    kindOf: defaultKindOf,
  };
  if (deleted) schema.deleted = deleted;
  return schema;
}
