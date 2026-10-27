// Row access rules (decision 0200; Roles and permissions): what PUT /:id/access-rules saves,
// without a database. Fictional data only.
import {
  defaultConfig,
  newDatabaseSchema,
  newProperty,
  type Property,
  type RowAccessRule,
} from '@carehub/databases';
import { ACCESS_MESSAGES } from '@carehub/databases/access';
import { describe, expect, it } from 'vitest';
import { planAccessRules } from './access-rules';
import type { DatabaseRecord } from './record';

const NOW = new Date('2026-10-27T06:00:00Z');

/** Blue Pine Plumbing's jobs: Name, Crew (Person), Margin owner (Person) and Created by. */
function jobs(): DatabaseRecord {
  const [name] = newDatabaseSchema().properties;
  const properties: Property[] = [
    name!,
    newProperty('Crew', defaultConfig('person')),
    newProperty('Margin owner', defaultConfig('person')),
    newProperty('Created by', defaultConfig('created_by')),
  ];
  return {
    id: '6f1d2a3e-0000-4000-8000-0000000000d1',
    workspaceId: '6f1d2a3e-0000-4000-8000-0000000000e1',
    spaceId: '6f1d2a3e-0000-4000-8000-0000000000f1',
    parentId: null,
    title: 'Blue Pine Plumbing jobs',
    pageIcon: null,
    inline: false,
    inTrash: false,
    description: [],
    properties,
    views: [],
    templates: [],
    accessRules: [],
    defaultTemplateId: null,
    locked: false,
    rowPageLayout: null,
    subItems: null,
    dependencies: null,
    deletedProperties: [],
    version: 1,
    nextUniqueNumber: 1,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const id = (record: DatabaseRecord, name: string): string =>
  record.properties.find((p) => p.name === name)!.id;

const none = new Set<string>();

describe('planAccessRules', () => {
  it('saves the sent rules in order, checked with the package', () => {
    const record = jobs();
    const rules: RowAccessRule[] = [
      { id: 'r1', propertyId: id(record, 'Crew'), level: 'edit' },
      { id: 'r2', propertyId: id(record, 'Created by'), level: 'full' },
    ];
    expect(planAccessRules(record, rules, none)).toEqual(rules);
    expect(planAccessRules({ ...record, accessRules: rules }, [], none)).toEqual([]);

    const name = [{ id: 'r1', propertyId: id(record, 'Name'), level: 'view' as const }];
    expect(() => planAccessRules(record, name, none)).toThrow(ACCESS_MESSAGES.ruleProperty);
    const twice = [rules[0]!, { ...rules[0]!, id: 'r3', level: 'view' as const }];
    expect(() => planAccessRules(record, twice, none)).toThrow(ACCESS_MESSAGES.ruleTaken('Crew'));
    const gone = [{ id: 'r1', propertyId: 'no-such-property', level: 'view' as const }];
    expect(() => planAccessRules(record, gone, none)).toThrow(ACCESS_MESSAGES.noProperty);
  });

  it("keeps rules on properties the person can't see, and refuses changes to them", () => {
    const base = jobs();
    const owner = id(base, 'Margin owner');
    const kept: RowAccessRule = { id: 'r9', propertyId: owner, level: 'full' };
    const record = { ...base, accessRules: [kept] };
    const hidden = new Set([owner]);
    const crew: RowAccessRule = { id: 'r1', propertyId: id(record, 'Crew'), level: 'comment' };

    expect(planAccessRules(record, [crew], hidden)).toEqual([crew, kept]);
    expect(planAccessRules(record, [kept, crew], hidden)).toEqual([kept, crew]);
    const changed = [{ ...kept, level: 'view' as const }];
    expect(() => planAccessRules(record, changed, hidden)).toThrow(ACCESS_MESSAGES.noProperty);
    const added = [{ id: 'r2', propertyId: owner, level: 'view' as const }];
    expect(() => planAccessRules(record, added, hidden)).toThrow(ACCESS_MESSAGES.noProperty);
    const reused = [{ ...crew, id: kept.id }];
    expect(() => planAccessRules(record, reused, hidden)).toThrow(ACCESS_MESSAGES.noProperty);
  });
});
