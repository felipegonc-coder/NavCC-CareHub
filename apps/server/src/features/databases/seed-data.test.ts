// The databases seed's data (decision 0007 section 2.5): Blue Pine Plumbing's jobs pass the checks
// createDatabase makes, without a database. Fictional data only.
import { describe, expect, it } from 'vitest';
import { planDefinition, topLevelDefinitionSchema } from './define';
import { jobsDefinition } from './seed-data';

const people = {
  admin: { id: '7a1c0000-0000-4000-8000-0000000000b1' },
  editor: { id: '7a1c0000-0000-4000-8000-0000000000b2' },
};

describe('the jobs definition', () => {
  it('passes the checks createDatabase makes', () => {
    const def = topLevelDefinitionSchema.parse(jobsDefinition(people, '2026-10-30'));
    const plan = planDefinition(def, {
      databaseId: '7a1c0000-0000-4000-8000-000000000001',
      workspaceId: '7a1c0000-0000-4000-8000-0000000000e1',
      spaceId: '7a1c0000-0000-4000-8000-0000000000f1',
      templateIds: ['7a1c0000-0000-4000-8000-000000000101'],
      rowIds: [1, 2, 3, 4].map((n) => `7a1c0000-0000-4000-8000-00000000020${n}`),
      linkCode: () => 'seedcode',
      related: new Map(),
    });
    const [table, board, calendar, form] = plan.settings.views;
    expect(plan.settings.views.map((v) => [v.name, v.layout])).toEqual([
      ['All jobs', 'table'],
      ['By status', 'board'],
      ['Visits', 'calendar'],
      ['Request a visit', 'form'],
    ]);
    expect(table?.properties[0]?.propertyId).toBe('job');
    expect(board?.grouping?.propertyId).toBe('status');
    expect(calendar?.calendar?.showBy).toBe('visit');
    expect(form?.form?.questions.map((q) => q.propertyId)).toEqual([
      'job',
      'kind',
      'visit',
      'notes',
    ]);
    expect(form?.form?.linkCode).toBe('seedcode');
    const cost = plan.settings.properties.find((p) => p.id === 'cost');
    expect(cost?.config).toMatchObject({ resultKind: 'number' });
    expect(plan.settings.templates.map((t) => t.name)).toEqual(['Callout']);

    expect(
      plan.rows.map((r) => [r.uniqueNumber, (r.values.visit as { start: string }).start]),
    ).toEqual([
      [1, '2026-10-28'],
      [2, '2026-10-30'],
      [3, '2026-11-02'],
      [4, '2026-11-06'],
    ]);
    expect(plan.rows[0]?.values).toMatchObject({
      hours: '1.5',
      paid: true,
      crew: [people.editor.id],
    });
    expect(plan.nextUniqueNumber).toBe(5);
    expect(plan.needsFull).toBe(false);
  });
});
