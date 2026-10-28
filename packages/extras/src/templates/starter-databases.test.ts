import { validateRules } from '@carehub/databases/access';
import { matchesFilter, validateFilter } from '@carehub/databases/filter';
import {
  propertySchema,
  rowAccessRuleSchema,
  rowTemplateSchema,
  viewSchema,
} from '@carehub/databases/schemas';
import { validateTemplate } from '@carehub/databases/templates';
import type { EvalContext, Row, View } from '@carehub/databases/types';
import { validateValue } from '@carehub/databases/values';
import { describe, expect, it } from 'vitest';
import {
  databaseForUse,
  describeDatabase,
  freshIds,
  readableIds,
  type StarterDatabase,
  type StarterDatabaseBuild,
} from './databases';
import {
  COACHING_HEADINGS,
  agents,
  coachingConversations,
  contentCalendar,
  eventSignUp,
  feedbackForm,
  projectTracker,
  qaReviews,
  requestForm,
  taskBoard,
} from './starter-databases';

const ALL: Record<string, StarterDatabaseBuild> = {
  projectTracker,
  taskBoard,
  contentCalendar,
  requestForm,
  feedbackForm,
  eventSignUp,
  agents,
  qaReviews,
  coachingConversations,
};

const NOW = new Date('2026-10-27T15:00:00.000Z');
const use = (build: StarterDatabaseBuild, includeRows = true) =>
  databaseForUse(build, {
    userId: 'user-avery',
    timeZone: 'America/Denver',
    now: NOW,
    includeRows,
  });

const names = (database: StarterDatabase) => database.properties.map((p) => p.name);
const viewNamed = (database: StarterDatabase, name: string): View => {
  const view = database.views.find((v) => v.name === name);
  if (!view) throw new Error(`No view ${name}`);
  return view;
};
const idOf = (database: StarterDatabase, name: string) =>
  database.properties.find((p) => p.name === name)?.id ?? '';

/** The sample rows as rows, for the filter engine. */
const rowsOf = (database: StarterDatabase): Row[] =>
  database.rows.map((row, i) => ({
    id: `row-${i}`,
    title: row.title,
    values: row.values,
    createdAt: NOW.toISOString(),
    createdBy: 'user-avery',
    editedAt: NOW.toISOString(),
    editedBy: 'user-avery',
    uniqueNumber: i + 1,
  }));
const contextFor = (database: StarterDatabase, userId: string): EvalContext => ({
  properties: database.properties,
  viewer: { userId, timeZone: 'America/Denver', weekStart: 0, hour12: true, now: NOW },
  userName: () => undefined,
});

describe('starter databases', () => {
  for (const [name, build] of Object.entries(ALL)) {
    describe(name, () => {
      const database = build(readableIds);

      it('fits the Databases shapes', () => {
        expect(database.properties[0]?.config.type).toBe('title');
        for (const property of database.properties) {
          expect(propertySchema.safeParse(property).success).toBe(true);
        }
        for (const view of database.views) {
          expect(viewSchema.safeParse(view).success).toBe(true);
          expect(validateFilter(view.filter, database.properties)).toBeNull();
        }
        for (const rule of database.accessRules) {
          expect(rowAccessRuleSchema.safeParse(rule).success).toBe(true);
        }
        expect(validateRules(database.accessRules, database.properties)).toBeNull();
        for (const { markdown, ...template } of database.templates) {
          expect(typeof markdown).toBe('string');
          expect(rowTemplateSchema.safeParse(template).success).toBe(true);
          expect(
            validateTemplate(template, database.properties, { validate: validateValue }),
          ).toBeNull();
        }
        if (database.defaultTemplateId !== null) {
          expect(database.templates.map((t) => t.id)).toContain(database.defaultTemplateId);
        }
      });

      it('points only at its own properties', () => {
        const ids = new Set(database.properties.map((p) => p.id));
        for (const view of database.views) {
          for (const setting of view.properties) expect(ids.has(setting.propertyId)).toBe(true);
          for (const sort of view.sorts) expect(ids.has(sort.propertyId)).toBe(true);
          if (view.grouping) expect(ids.has(view.grouping.propertyId)).toBe(true);
          for (const question of view.form?.questions ?? []) {
            expect(ids.has(question.propertyId)).toBe(true);
          }
        }
        for (const row of database.rows) {
          for (const key of Object.keys(row.values)) expect(ids.has(key)).toBe(true);
        }
      });

      it('has sample rows with values that fit, filled in for the person using it', () => {
        expect(database.rows.length).toBeGreaterThan(0);
        const used = use(build);
        for (const row of used.rows) {
          expect(row.title.trim().length).toBeGreaterThan(0);
          for (const [id, value] of Object.entries(row.values)) {
            const property = used.properties.find((p) => p.id === id);
            if (!property) throw new Error(`No property ${id}`);
            const checked = validateValue(property, value);
            expect(checked.ok).toBe(true);
          }
        }
        expect(use(build, false).rows).toEqual([]);
      });

      it('gets new ids on each use, consistently', () => {
        const first = build(freshIds());
        const second = build(freshIds());
        expect(first.properties[0]?.id).not.toBe(second.properties[0]?.id);
        expect(first.views[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
        const ids = new Set(first.properties.map((p) => p.id));
        for (const view of first.views) {
          for (const setting of view.properties) expect(ids.has(setting.propertyId)).toBe(true);
        }
        for (const rule of first.accessRules) expect(ids.has(rule.propertyId)).toBe(true);
      });

      it('describes itself for the preview', () => {
        const text = describeDatabase(database);
        expect(text).toContain(database.description);
        for (const property of database.properties) expect(text).toContain(property.name);
        for (const row of database.rows) expect(text).toContain(row.title);
        expect(text).not.toMatch(/https?:\/\//);
      });
    });
  }

  it('fills in Me and Today in the sample rows', () => {
    const database = use(qaReviews);
    const reviewer = idOf(database, 'Reviewer');
    const date = idOf(database, 'Date');
    expect(database.rows[0]?.values[reviewer]).toEqual(['user-avery']);
    expect(database.rows[0]?.values[date]).toEqual({
      start: '2026-10-24',
      end: null,
      hasTime: false,
    });
  });
});

describe('Customer Care starters (TB-17)', () => {
  it('Agents has its properties, views and 3 sample rows', () => {
    const database = agents(readableIds);
    expect(names(database)).toEqual([
      'Name',
      'Person',
      'Team',
      'Team lead',
      'Start date',
      'Status',
    ]);
    const status = database.properties.find((p) => p.name === 'Status')?.config;
    expect(status?.type === 'select' ? status.options.map((o) => o.name) : []).toEqual([
      'Active',
      'On leave',
      'Left',
    ]);
    expect(database.views.map((v) => v.name)).toEqual(['All agents', 'By team']);
    expect(viewNamed(database, 'By team').grouping?.propertyId).toBe(idOf(database, 'Team'));
    expect(database.rows).toHaveLength(3);
  });

  it('QA reviews comes with Agent → Can view, and My reviews shows only the viewer’s rows', () => {
    const database = qaReviews(readableIds);
    expect(names(database)).toEqual([
      'Review',
      'Agent',
      'Reviewer',
      'Team lead',
      'Date',
      'Channel',
      'Score',
      'Status',
      'Ticket link',
      'Notes',
    ]);
    expect(database.views.map((v) => v.name)).toEqual(['All reviews', 'By agent', 'My reviews']);
    expect(database.accessRules).toEqual([
      { id: 'rule:agent', propertyId: idOf(database, 'Agent'), level: 'view' },
    ]);
    expect(database.rows).toHaveLength(3);

    const agent = idOf(database, 'Agent');
    const rows = rowsOf(database).map((row, i) => ({
      ...row,
      values: { ...row.values, [agent]: [i === 0 ? 'user-jordan' : 'user-priya'] },
    }));
    const mine = viewNamed(database, 'My reviews').filter;
    const shown = (userId: string) =>
      rows.filter((row) => matchesFilter(row, mine, contextFor(database, userId))).map((r) => r.id);
    expect(shown('user-jordan')).toEqual(['row-0']);
    expect(shown('user-priya')).toEqual(['row-1', 'row-2']);
    expect(shown('user-avery')).toEqual([]);
  });

  it('Coaching conversations start from a template with the three headings', () => {
    const database = coachingConversations(readableIds);
    expect(names(database)).toEqual([
      'Conversation',
      'Agent',
      'Coach',
      'Date',
      'Focus',
      'Agreed actions',
      'Follow-up date',
      'Status',
    ]);
    expect(database.views.map((v) => v.name)).toEqual(['Upcoming', 'My conversations']);
    const template = database.templates.find((t) => t.id === database.defaultTemplateId);
    expect(template?.name).toBe('Coaching conversation');
    expect(template?.markdown).toBe(
      '## What went well\n\n- \n\n## What to work on\n\n- \n\n## Agreed actions\n\n- \n',
    );
    for (const heading of COACHING_HEADINGS) expect(template?.markdown).toContain(`## ${heading}`);
    expect(database.rows).toHaveLength(3);
  });

  it('My conversations shows rows where the viewer is the agent or the coach', () => {
    const database = coachingConversations(readableIds);
    const agent = idOf(database, 'Agent');
    const coach = idOf(database, 'Coach');
    const rows = rowsOf(database).map((row, i) => ({
      ...row,
      values: {
        ...row.values,
        [agent]: [i === 0 ? 'user-jordan' : 'user-priya'],
        [coach]: [i === 2 ? 'user-jordan' : 'user-sam'],
      },
    }));
    const mine = viewNamed(database, 'My conversations').filter;
    const shown = (userId: string) =>
      rows.filter((row) => matchesFilter(row, mine, contextFor(database, userId))).map((r) => r.id);
    expect(shown('user-jordan')).toEqual(['row-0', 'row-2']);
    expect(shown('user-sam')).toEqual(['row-0', 'row-1']);
  });

  it('Upcoming shows planned conversations, soonest first', () => {
    const database = coachingConversations(readableIds);
    const upcoming = viewNamed(database, 'Upcoming');
    const shown = rowsOf(database).filter((row) =>
      matchesFilter(row, upcoming.filter, contextFor(database, 'user-avery')),
    );
    expect(shown.map((row) => row.title)).toEqual([
      'Avery Lin · Refund calls',
      'Priya Nair · Back from leave',
    ]);
    expect(upcoming.sorts).toEqual([{ propertyId: idOf(database, 'Date'), direction: 'asc' }]);
  });
});
