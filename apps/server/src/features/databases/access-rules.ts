// Row access rules (decision 0200; Roles and permissions): the rules PUT /:id/access-rules saves.
// Pure: the route checks Full access and saves them. Rules are checked with the package's
// validateRules; ones on properties the person can't see stay as they are.
import { isDeepStrictEqual } from 'node:util';
import type { Id, RowAccessRule } from '@carehub/databases';
import { ACCESS_MESSAGES, validateRules } from '@carehub/databases/access';
import { invalid } from './errors';
import type { DatabaseRecord } from './record';

/**
 * The database's rules after a PUT: the sent ones in order, then the saved rules on properties the
 * person can't see. They can't add, change or remove those (sending one back unchanged is fine);
 * like a property that doesn't exist, the rule is refused.
 */
export function planAccessRules(
  current: DatabaseRecord,
  sent: readonly RowAccessRule[],
  hidden: ReadonlySet<Id>,
): RowAccessRule[] {
  const kept = current.accessRules.filter((rule) => hidden.has(rule.propertyId));
  for (const rule of sent) {
    const saved = kept.find((k) => k.id === rule.id);
    if ((saved || hidden.has(rule.propertyId)) && !isDeepStrictEqual(saved, rule)) {
      throw invalid(ACCESS_MESSAGES.noProperty);
    }
  }
  const sentIds = new Set(sent.map((rule) => rule.id));
  const rules = [...sent, ...kept.filter((rule) => !sentIds.has(rule.id))].map((rule) => ({
    id: rule.id,
    propertyId: rule.propertyId,
    level: rule.level,
  }));
  const problem = validateRules(rules, current.properties);
  if (problem) throw invalid(problem);
  return rules;
}
