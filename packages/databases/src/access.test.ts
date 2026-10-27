import { describe, expect, it } from 'vitest';
import {
  ACCESS_LABELS,
  ACCESS_MESSAGES,
  DATABASE_GRANTS,
  DB_ACTIONS,
  GRANT_LABELS,
  accessToRow,
  atLeast,
  can,
  canChangeProperty,
  canSeeProperty,
  databasePageAccess,
  inheritedRowAccess,
  losesOwnAccess,
  maxAccess,
  maxGrant,
  namesViewer,
  openableRows,
  rowAccess,
  ruleAccess,
  ruleProperties,
  validateRules,
  viewUsesHiddenProperty,
  visibleProperties,
  type AccessSubject,
  type DbAction,
  type PropertyViewer,
} from './access';
import { defaultConfig } from './schema';
import {
  ACCESS_LEVELS,
  type AccessLevel,
  type DatabaseGrant,
  type FilterGroup,
  type Property,
  type PropertyAccess,
  type PropertyConfig,
  type Row,
  type RowAccessRule,
} from './types';

const prop = (id: string, name: string, config: PropertyConfig, access?: PropertyAccess) => {
  const p: Property = { id, name, description: '', config, rowPage: 'always' };
  if (access) p.access = access;
  return p;
};
const person = (id: string, name: string) =>
  prop(id, name, { type: 'person', single: false, notify: true });

const nameProp = prop('p-name', 'Name', { type: 'title' });
const agent = person('p-agent', 'Agent');
const reviewer = person('p-reviewer', 'Reviewer');
const createdBy = prop('p-created-by', 'Created by', { type: 'created_by' });
const notes = prop('p-notes', 'Notes', { type: 'text' });
const score = prop('p-score', 'Score', defaultConfig('number'), {
  see: [
    { type: 'group', id: 'g-leads' },
    { type: 'role', id: 'r-admin' },
  ],
  change: [{ type: 'user', id: 'u-jordan' }],
});
const properties: Property[] = [nameProp, agent, reviewer, createdBy, notes, score];

const row = (
  id: string,
  values: Row['values'],
  createdByUser: string | null = 'u-jordan',
): Row => ({
  id,
  title: `Review ${id}`,
  values,
  createdAt: '2026-10-20T15:00:00.000Z',
  createdBy: createdByUser,
  editedAt: '2026-10-20T15:00:00.000Z',
  editedBy: createdByUser,
  uniqueNumber: null,
});
const r1 = row('r1', { 'p-agent': ['u-avery'] });
const r2 = row('r2', { 'p-agent': ['u-sam'] });
const r3 = row('r3', { 'p-agent': ['u-sam', 'u-avery'] });
const r4 = row('r4', { 'p-reviewer': ['u-avery'] });
const rows = [r1, r2, r3, r4];

const agentCanView: RowAccessRule = { id: 'rule-1', propertyId: 'p-agent', level: 'view' };
const subject = (
  userId: string | null,
  database: DatabaseGrant,
  more: Partial<AccessSubject> = {},
) => ({ userId, database, rules: [agentCanView], properties, ...more }) satisfies AccessSubject;

const avery: PropertyViewer = { userId: 'u-avery', roleId: 'r-member', groupIds: ['g-agents'] };
const jordan: PropertyViewer = { userId: 'u-jordan', roleId: 'r-member', groupIds: ['g-leads'] };
const sam: PropertyViewer = { userId: 'u-sam', roleId: 'r-admin' };

describe('access levels', () => {
  it('orders none < view < comment < edit_content < edit < full', () => {
    expect([...ACCESS_LEVELS]).toEqual(['none', 'view', 'comment', 'edit_content', 'edit', 'full']);
    ACCESS_LEVELS.forEach((a, i) => {
      ACCESS_LEVELS.forEach((b, j) => expect(atLeast(a, b)).toBe(i >= j));
    });
  });

  it('counts a missing level as none', () => {
    expect(atLeast(null, 'none')).toBe(true);
    expect(atLeast(undefined, 'view')).toBe(false);
    expect(maxAccess()).toBe('none');
    expect(maxAccess(null, 'view', undefined, 'edit_content', 'comment')).toBe('edit_content');
    expect(maxAccess('full', 'edit')).toBe('full');
  });

  it('names every level and the Share menu', () => {
    expect(ACCESS_LABELS).toEqual({
      none: 'No access',
      view: 'Can view',
      comment: 'Can comment',
      edit_content: 'Can edit content',
      edit: 'Can edit',
      full: 'Full access',
    });
    expect(GRANT_LABELS.rows_only).toBe("Only rows they're in");
    expect(GRANT_LABELS.edit_content).toBe('Can edit content');
    expect([...DATABASE_GRANTS]).toEqual([
      'full',
      'edit',
      'edit_content',
      'rows_only',
      'comment',
      'view',
    ]);
  });

  it('puts rows_only above none and below Can view when grants combine', () => {
    expect(maxGrant('rows_only')).toBe('rows_only');
    expect(maxGrant('none', 'rows_only', null)).toBe('rows_only');
    expect(maxGrant('rows_only', 'view')).toBe('view');
    expect(maxGrant('comment', 'rows_only', 'edit_content')).toBe('edit_content');
    expect(maxGrant(null, undefined)).toBe('none');
    expect(maxGrant()).toBe('none');
  });

  it('treats rows_only as Can view on the database page and nothing on rows', () => {
    expect(databasePageAccess('rows_only')).toBe('view');
    expect(databasePageAccess('edit_content')).toBe('edit_content');
    expect(databasePageAccess(null)).toBe('none');
    expect(inheritedRowAccess('rows_only')).toBe('none');
    expect(inheritedRowAccess(undefined)).toBe('none');
  });

  it('passes Can edit content down to rows as Can edit, and the rest as they are', () => {
    expect(inheritedRowAccess('edit_content')).toBe('edit');
    for (const level of ['none', 'view', 'comment', 'edit', 'full'] as const) {
      expect(inheritedRowAccess(level)).toBe(level);
    }
  });
});

describe('row access rules', () => {
  it('gives the rule level on rows whose Person property names them', () => {
    expect(ruleAccess(r1, [agentCanView], 'u-avery', properties)).toBe('view');
    expect(ruleAccess(r3, [agentCanView], 'u-avery', properties)).toBe('view');
    expect(ruleAccess(r2, [agentCanView], 'u-avery', properties)).toBe('none');
  });

  it('takes the highest matching rule', () => {
    const rules: RowAccessRule[] = [
      agentCanView,
      { id: 'rule-2', propertyId: 'p-reviewer', level: 'edit' },
    ];
    const both = row('r9', { 'p-agent': ['u-avery'], 'p-reviewer': ['u-avery'] });
    expect(ruleAccess(both, rules, 'u-avery', properties)).toBe('edit');
    expect(ruleAccess(r4, rules, 'u-avery', properties)).toBe('edit');
  });

  it('matches Created by, but never an anonymous response (FM-17)', () => {
    const rules: RowAccessRule[] = [{ id: 'rule-c', propertyId: 'p-created-by', level: 'view' }];
    const mine = row('f1', {}, 'u-avery');
    const anonymous = row('f2', {}, null);
    expect(ruleAccess(mine, rules, 'u-avery', properties)).toBe('view');
    expect(ruleAccess(mine, rules, 'u-sam', properties)).toBe('none');
    expect(ruleAccess(anonymous, rules, 'u-avery', properties)).toBe('none');
    const respondent = subject('u-avery', 'rows_only', { rules });
    expect(openableRows([mine, anonymous, row('f3', {}, 'u-sam')], respondent)).toEqual([mine]);
  });

  it('gives nothing for rules on deleted or other properties, or nobody signed in', () => {
    const rules: RowAccessRule[] = [
      { id: 'rule-x', propertyId: 'p-gone', level: 'full' },
      { id: 'rule-y', propertyId: 'p-notes', level: 'full' },
    ];
    const r = row('r8', { 'p-notes': 'u-avery' });
    expect(ruleAccess(r, rules, 'u-avery', properties)).toBe('none');
    expect(ruleAccess(r1, [agentCanView], null, properties)).toBe('none');
    expect(ruleAccess(r1, [agentCanView], undefined, properties)).toBe('none');
  });

  it("takes a row's access from the database, its own sharing and the rules", () => {
    expect(rowAccess({ inherited: 'view', rule: 'edit' })).toBe('edit');
    expect(rowAccess({ inherited: 'full', rule: 'view' })).toBe('full');
    expect(rowAccess({ inherited: 'edit_content' })).toBe('edit');
    expect(rowAccess({ inherited: 'rows_only' })).toBe('none');
    expect(rowAccess({ inherited: 'rows_only', rule: 'comment' })).toBe('comment');
    expect(rowAccess({ inherited: 'rows_only', direct: 'edit' })).toBe('edit');
    expect(rowAccess({ inherited: null, direct: null, rule: undefined })).toBe('none');
  });

  it('shows a rows-only person just their rows (DB-32)', () => {
    const averyRows = subject('u-avery', 'rows_only');
    expect(openableRows(rows, averyRows)).toEqual([r1, r3]);
    expect(openableRows(rows, subject('u-sam', 'rows_only'))).toEqual([r2, r3]);
    expect(accessToRow(r2, averyRows)).toBe('none');
    expect(can('view', accessToRow(r2, averyRows), { locked: false })).toBe(false);
    expect(can('view', accessToRow(r1, averyRows), { locked: false })).toBe(true);
    expect(can('edit_rows', accessToRow(r1, averyRows), { locked: false })).toBe(false);
  });

  it('keeps Jordan to rows naming him, and no adding rows with Can add rows off (AX-07)', () => {
    const jordanRows = subject('u-jordan', 'rows_only');
    const his = row('r7', { 'p-agent': ['u-jordan'] });
    expect(openableRows([...rows, his], jordanRows)).toEqual([his]);
    expect(accessToRow(r1, jordanRows)).toBe('none');
    expect(can('add_rows', 'rows_only', { locked: false })).toBe(false);
    expect(can('view', 'rows_only', { locked: false })).toBe(true);
  });

  it('shows team leads with Can edit every row', () => {
    const leads = subject('u-jordan', 'edit');
    expect(openableRows(rows, leads)).toEqual(rows);
    expect(openableRows(rows, leads)).not.toBe(rows);
    expect(accessToRow(r2, leads)).toBe('edit');
  });

  it('follows a change of Person value at once (DB-33)', () => {
    const moved = row('r1', { 'p-agent': ['u-sam'] });
    expect(accessToRow(r1, subject('u-avery', 'rows_only'))).toBe('view');
    expect(accessToRow(moved, subject('u-avery', 'rows_only'))).toBe('none');
    expect(accessToRow(moved, subject('u-sam', 'rows_only'))).toBe('view');
  });

  it("adds the row page's own sharing", () => {
    const shared = subject('u-avery', 'rows_only', {
      direct: (id) => (id === 'r2' ? 'comment' : null),
    });
    expect(accessToRow(r2, shared)).toBe('comment');
    expect(openableRows(rows, shared)).toEqual([r1, r2, r3]);
  });

  it('lets rows-only people with Can add rows see the rows they add', () => {
    const added = row('r5', {}, 'u-avery');
    expect(accessToRow(added, subject('u-avery', 'rows_only'))).toBe('none');
    expect(accessToRow(added, subject('u-avery', 'rows_only', { canAddRows: true }))).toBe('view');
    const editOwn: RowAccessRule = { id: 'rule-c', propertyId: 'p-created-by', level: 'edit' };
    const withRule = subject('u-avery', 'rows_only', {
      canAddRows: true,
      rules: [agentCanView, editOwn],
    });
    expect(accessToRow(added, withRule)).toBe('edit');
    expect(accessToRow(r2, subject('u-avery', 'rows_only', { canAddRows: true }))).toBe('none');
    expect(rowAccess({ inherited: 'none', addedByThem: true })).toBe('none');
    expect(accessToRow(row('r6', {}, null), subject(null, 'rows_only', { canAddRows: true }))).toBe(
      'none',
    );
  });

  it("warns before someone takes away their own access: You'll lose access to this row.", () => {
    expect(ACCESS_MESSAGES.losesAccess).toBe("You'll lose access to this row.");
    const editsOwn = subject('u-avery', 'rows_only', {
      rules: [{ id: 'rule-1', propertyId: 'p-agent', level: 'edit' }],
    });
    const without = row('r1', { 'p-agent': ['u-sam'] });
    expect(losesOwnAccess(r1, without, editsOwn)).toBe(true);
    expect(losesOwnAccess(r3, row('r3', { 'p-agent': ['u-avery'] }), editsOwn)).toBe(false);
    expect(losesOwnAccess(r2, r1, editsOwn)).toBe(false);
    expect(losesOwnAccess(r1, without, subject('u-avery', 'edit'))).toBe(false);
  });
});

describe('can', () => {
  // The lowest level each action needs, from the permission tables (Lock structure off).
  const needs: Record<DbAction, AccessLevel> = {
    view: 'view',
    comment: 'comment',
    edit_rows: 'edit_content',
    add_rows: 'edit_content',
    use_templates: 'edit_content',
    export: 'view',
    import: 'edit',
    create_options: 'edit',
    edit_views: 'edit',
    edit_properties: 'edit',
    edit_forms: 'edit',
    manage_templates: 'edit',
    lock: 'full',
    share: 'full',
    delete_database: 'full',
    set_row_rules: 'full',
    set_property_access: 'full',
    manage_form_access: 'full',
    submit_form: 'edit',
    toggle_responses: 'full',
    change_form_link: 'full',
  };

  it('follows the permission tables at every level', () => {
    expect(Object.keys(needs).sort()).toEqual([...DB_ACTIONS].sort());
    for (const action of DB_ACTIONS) {
      for (const level of ACCESS_LEVELS) {
        expect([action, level, can(action, level, { locked: false })]).toEqual([
          action,
          level,
          atLeast(level, needs[action]),
        ]);
      }
    }
  });

  it('lets Can edit content add, edit and delete rows but not change structure or sharing (DB-35)', () => {
    const allowed = DB_ACTIONS.filter((a) => can(a, 'edit_content', { locked: false }));
    expect(allowed).toEqual([
      'view',
      'comment',
      'edit_rows',
      'add_rows',
      'use_templates',
      'export',
    ]);
    for (const action of ['edit_properties', 'edit_views', 'share', 'create_options'] as const) {
      expect(can(action, 'edit_content', { locked: false })).toBe(false);
    }
  });

  it('gives rows_only Can view on the database page, and adding rows only with Can add rows', () => {
    const plain = DB_ACTIONS.filter((a) => can(a, 'rows_only', { locked: false }));
    expect(plain).toEqual(['view', 'export']);
    const adding = DB_ACTIONS.filter((a) =>
      can(a, 'rows_only', { locked: false, canAddRows: true }),
    );
    expect(adding).toEqual(['view', 'add_rows', 'use_templates', 'export']);
    expect(can('add_rows', 'none', { locked: false, canAddRows: true })).toBe(false);
    expect(can('edit_rows', 'edit', { locked: false })).toBe(true);
  });

  it('stops views, properties, forms and templates while Lock structure is on, not rows (DB-21)', () => {
    const locked = DB_ACTIONS.filter((a) => can(a, 'full', { locked: true }));
    expect(locked).not.toContain('edit_views');
    expect(locked).not.toContain('edit_properties');
    expect(locked).not.toContain('edit_forms');
    expect(locked).not.toContain('manage_templates');
    for (const action of ['edit_rows', 'add_rows', 'create_options', 'import'] as const) {
      expect(can(action, 'edit', { locked: true })).toBe(true);
    }
    expect(can('edit_views', 'edit', { locked: true })).toBe(false);
    expect(can('lock', 'full', { locked: true })).toBe(true);
  });

  it('lets anyone submit through a form link that takes responses', () => {
    expect(can('submit_form', 'none', { locked: false, accepting: true })).toBe(true);
    expect(can('submit_form', null, { locked: true, accepting: true })).toBe(true);
    expect(can('submit_form', 'edit_content', { locked: false, accepting: false })).toBe(false);
    expect(can('submit_form', 'edit', { locked: false })).toBe(true);
  });

  it('refuses unknown actions and missing access', () => {
    expect(can('rename_everything' as DbAction, 'full', { locked: false })).toBe(false);
    expect(can('view', undefined, { locked: false })).toBe(false);
    expect(can('view', null, { locked: false })).toBe(false);
  });
});

describe('validateRules', () => {
  it('accepts up to 10 rules on Person or Created by properties', () => {
    const people = Array.from({ length: 10 }, (_, i) => person(`p-${i}`, `Person ${i}`));
    const rules = people.map((p, i): RowAccessRule => ({
      id: `r-${i}`,
      propertyId: p.id,
      level: 'view',
    }));
    expect(validateRules(rules, people)).toBeNull();
    expect(validateRules([], properties)).toBeNull();
    const extra: RowAccessRule = { id: 'r-x', propertyId: 'p-0', level: 'view' };
    expect(validateRules([...rules, extra], people)).toBe('Up to 10 rules.');
  });

  it('names each problem', () => {
    const one = (propertyId: string, level: string) =>
      validateRules([{ id: 'r', propertyId, level } as RowAccessRule], properties);
    expect(one('p-gone', 'view')).toBe("That property doesn't exist.");
    expect(one('p-notes', 'view')).toBe('Rules can only use a Person or Created by property.');
    expect(one('p-agent', 'edit_content')).toBe(
      'Choose Can view, Can comment, Can edit or Full access.',
    );
    expect(one('p-agent', 'none')).toBe('Choose Can view, Can comment, Can edit or Full access.');
    for (const level of ['view', 'comment', 'edit', 'full'])
      expect(one('p-created-by', level)).toBeNull();
    const twice: RowAccessRule[] = [
      agentCanView,
      { id: 'rule-2', propertyId: 'p-agent', level: 'edit' },
    ];
    expect(validateRules(twice, properties)).toBe("'Agent' already has a rule.");
  });

  it('offers only Person and Created by properties', () => {
    expect(ruleProperties(properties).map((p) => p.id)).toEqual([
      'p-agent',
      'p-reviewer',
      'p-created-by',
    ]);
  });
});

describe('property access', () => {
  it('matches people, groups and roles on a list', () => {
    expect(namesViewer([{ type: 'user', id: 'u-avery' }], avery)).toBe(true);
    expect(namesViewer([{ type: 'group', id: 'g-agents' }], avery)).toBe(true);
    expect(namesViewer([{ type: 'role', id: 'r-member' }], avery)).toBe(true);
    expect(namesViewer([{ type: 'group', id: 'g-leads' }], sam)).toBe(false);
    expect(namesViewer([{ type: 'role', id: 'r-admin' }], { userId: 'u-guest' })).toBe(false);
    expect(namesViewer([], jordan)).toBe(false);
  });

  it('shows a property to everyone unless its see list leaves them out', () => {
    expect(canSeeProperty(notes, avery)).toBe(true);
    expect(
      canSeeProperty(prop('p-open', 'Open', { type: 'text' }, { see: null, change: null }), avery),
    ).toBe(true);
    expect(canSeeProperty(score, avery)).toBe(false);
    expect(canSeeProperty(score, jordan)).toBe(true);
    expect(canSeeProperty(score, sam)).toBe(true);
  });

  it('always shows the Name property', () => {
    const lockedName = prop('p-name', 'Name', { type: 'title' }, { see: [], change: [] });
    expect(canSeeProperty(lockedName, avery)).toBe(true);
    expect(canChangeProperty(lockedName, avery, 'edit')).toBe(true);
    expect(canChangeProperty(lockedName, avery, 'comment')).toBe(false);
  });

  it('lets people who can edit change a property, narrowed by its change list', () => {
    expect(canChangeProperty(notes, avery, 'edit')).toBe(true);
    expect(canChangeProperty(notes, avery, 'edit_content')).toBe(true);
    expect(canChangeProperty(notes, avery, 'comment')).toBe(false);
    expect(canChangeProperty(notes, avery, null)).toBe(false);
    expect(canChangeProperty(score, jordan, 'edit')).toBe(true);
    expect(canChangeProperty(score, sam, 'full')).toBe(false);
    expect(canChangeProperty(score, jordan, 'view')).toBe(false);
  });

  it("doesn't let someone change what they can't see, even on the change list", () => {
    const odd = prop(
      'p-odd',
      'Odd',
      { type: 'text' },
      {
        see: [{ type: 'user', id: 'u-jordan' }],
        change: [{ type: 'user', id: 'u-avery' }],
      },
    );
    expect(canChangeProperty(odd, avery, 'full')).toBe(false);
    expect(canChangeProperty(odd, jordan, 'full')).toBe(false);
  });

  it('never lets anyone change values Care Hub fills in', () => {
    const auto: Property[] = [
      createdBy,
      prop('p-id', 'ID', { type: 'unique_id', prefix: 'QA' }),
      prop('p-f', 'Total', {
        type: 'formula',
        expression: '1',
        resultKind: 'number',
        number: null,
      }),
    ];
    for (const p of auto) expect(canChangeProperty(p, jordan, 'full')).toBe(false);
  });

  it('hides Score from agents but not team leads (DB-34)', () => {
    expect(visibleProperties(properties, avery).map((p) => p.id)).toEqual([
      'p-name',
      'p-agent',
      'p-reviewer',
      'p-created-by',
      'p-notes',
    ]);
    expect(visibleProperties(properties, jordan)).toEqual(properties);
  });

  it("flags a view that sorts, filters or groups by a property you can't see", () => {
    expect(ACCESS_MESSAGES.hiddenProperty).toBe("This view uses a property you can't see.");
    const plain = { filter: null, sorts: [], grouping: null, subGrouping: null };
    const sorted = { ...plain, sorts: [{ propertyId: 'p-score', direction: 'desc' as const }] };
    expect(viewUsesHiddenProperty(sorted, properties, avery)).toBe(true);
    expect(viewUsesHiddenProperty(sorted, properties, jordan)).toBe(false);
    expect(viewUsesHiddenProperty(plain, properties, avery)).toBe(false);
    const filter: FilterGroup = {
      kind: 'group',
      id: 'f',
      combinator: 'and',
      children: [
        { kind: 'condition', id: 'c1', propertyId: 'p-notes', op: 'is_not_empty' },
        {
          kind: 'group',
          id: 'g',
          combinator: 'or',
          children: [{ kind: 'condition', id: 'c2', propertyId: 'p-score', op: 'gt', value: '3' }],
        },
      ],
    };
    expect(viewUsesHiddenProperty({ ...plain, filter }, properties, avery)).toBe(true);
    const byScore = { propertyId: 'p-score' };
    expect(viewUsesHiddenProperty({ ...plain, grouping: byScore }, properties, avery)).toBe(true);
    expect(viewUsesHiddenProperty({ ...plain, subGrouping: byScore }, properties, avery)).toBe(
      true,
    );
    expect(
      viewUsesHiddenProperty({ filter: null, sorts: [], grouping: null }, properties, avery),
    ).toBe(false);
    const gone = { ...plain, sorts: [{ propertyId: 'p-gone', direction: 'asc' as const }] };
    expect(viewUsesHiddenProperty(gone, properties, avery)).toBe(false);
  });
});
