/** Schemas for sharing: access levels, who can see or change a property, and row access rules. */
import { z } from 'zod';
import { ACCESS_LEVELS, LIMITS } from '../types';
import type { DatabaseGrant, Principal, PropertyAccess, RowAccessRule } from '../types';
import { REQUEST_LIMITS, idSchema, isUniqueBy } from './common';

/** An access level, from "none" to "full". */
export const accessLevelSchema = z.enum(ACCESS_LEVELS);

/** What someone gets on a whole database: an access level, or "rows_only". */
export const databaseGrantSchema = z.enum([
  ...ACCESS_LEVELS,
  'rows_only',
]) satisfies z.ZodType<DatabaseGrant>;

/** A person, group or role that access is given to. */
export const principalSchema = z.strictObject({
  type: z.enum(['user', 'group', 'role']),
  id: idSchema,
}) satisfies z.ZodType<Principal>;

/** Up to 200 people, groups and roles, each listed once. */
export const principalsSchema = z
  .array(principalSchema)
  .max(REQUEST_LIMITS.principals)
  .refine((list) => isUniqueBy(list, (p) => `${p.type}:${p.id}`), 'Each one once.');

/** Who can see and who can change a property; null means everyone with access to the database. */
export const propertyAccessSchema = z.strictObject({
  see: principalsSchema.nullable(),
  change: principalsSchema.nullable(),
}) satisfies z.ZodType<PropertyAccess>;

/** A row access rule: people named in a Person or Created by property get this level on the row. */
export const rowAccessRuleSchema = z.strictObject({
  id: idSchema,
  propertyId: idSchema,
  level: z.enum(['view', 'comment', 'edit', 'full']),
}) satisfies z.ZodType<RowAccessRule>;

/** A database's row access rules: up to 10, each id once. */
export const rowAccessRulesSchema = z
  .array(rowAccessRuleSchema)
  .max(LIMITS.rowAccessRules)
  .refine((rules) => isUniqueBy(rules, (r) => r.id), 'Each rule once.');
