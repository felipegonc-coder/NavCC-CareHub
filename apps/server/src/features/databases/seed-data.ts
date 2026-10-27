// The databases seed's fictional data (decision 0007 section 2.5): Blue Pine Plumbing's jobs, with
// a board, a calendar, a form, a template and a few jobs around the day the seed runs. Pure, so
// its checks run without a database; seed.ts saves it.
import {
  ME,
  defaultConfig,
  defaultForm,
  newProperty,
  relationConfig,
  type Property,
  type PropertyConfig,
} from '@carehub/databases';
import { THIS_DATABASE, type DefinitionRow, type TopLevelDefinition } from './define';

export const SEED_TITLE = 'Blue Pine Plumbing jobs';

/** The seed's people the jobs use: who makes them and who's on the crews. */
export interface SeedPeople {
  admin: { id: string };
  editor: { id: string };
}

const DAY_MS = 86_400_000;

const prop = (id: string, name: string, config: PropertyConfig): Property => ({
  ...newProperty(name, config),
  id,
});

/** Blue Pine Plumbing's jobs. Ids are short and fixed, so browser tests can name them. */
export function jobProperties(): Property[] {
  return [
    prop('job', 'Job', { type: 'title' }),
    prop('status', 'Status', {
      type: 'status',
      options: [
        { id: 'not-started', name: 'Not started', color: 'default', group: 'todo' },
        { id: 'in-progress', name: 'In progress', color: 'blue', group: 'in_progress' },
        { id: 'done', name: 'Done', color: 'green', group: 'complete' },
      ],
      defaultOptionId: 'not-started',
    }),
    prop('kind', 'Kind', {
      type: 'select',
      options: [
        { id: 'repair', name: 'Repair', color: 'red' },
        { id: 'install', name: 'Install', color: 'blue' },
        { id: 'inspection', name: 'Inspection', color: 'green' },
      ],
    }),
    prop('crew', 'Crew', defaultConfig('person')),
    prop('visit', 'Visit', defaultConfig('date')),
    prop('hours', 'Hours', defaultConfig('number')),
    prop('cost', 'Cost', {
      type: 'formula',
      expression: 'prop("hours") * 95',
      resultKind: null,
      number: null,
    }),
    prop('paid', 'Paid', defaultConfig('checkbox')),
    prop('ref', 'Ref', { type: 'unique_id', prefix: 'BPP' }),
    prop('follow-up-of', 'Follow-up of', { ...relationConfig(THIS_DATABASE), single: true }),
    prop('notes', 'Notes', defaultConfig('text')),
  ];
}

/**
 * The jobs database as the seed makes it, with visits from two days before `today` (a calendar
 * date) to a week after.
 */
export function jobsDefinition(people: SeedPeople, today: string): TopLevelDefinition {
  const properties = jobProperties();
  const day = (offset: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) + offset * DAY_MS).toISOString().slice(0, 10);
  const visit = (offset: number) => ({ start: day(offset), end: null, hasTime: false });
  const crew = [people.editor.id];
  const rows: DefinitionRow[] = [
    {
      title: 'Leaky tap at the community centre',
      icon: '🚰',
      values: { status: 'done', kind: 'repair', crew, visit: visit(-2), hours: 1.5, paid: true },
    },
    {
      title: 'Boiler service, Maple Street',
      values: { status: 'in-progress', kind: 'inspection', crew, visit: visit(0), hours: 2 },
    },
    {
      title: 'New water heater, Cedar Lane',
      icon: '🔥',
      values: {
        status: 'not-started',
        kind: 'install',
        crew: [people.editor.id, people.admin.id],
        visit: visit(3),
        hours: 6,
        notes: 'Old tank goes to recycling. Bring the 40-gallon fittings.',
      },
    },
    {
      title: 'Blocked drain, Birch Court',
      values: { status: 'not-started', kind: 'repair', visit: visit(7) },
    },
  ];
  return {
    title: SEED_TITLE,
    icon: '🔧',
    description: [{ text: 'Every job the crews take on, from the first call to the invoice.' }],
    properties,
    templates: [
      {
        key: 'callout',
        name: 'Callout',
        icon: '🚨',
        values: { status: 'not-started', kind: 'repair', crew: [ME] },
      },
    ],
    views: [
      { layout: 'table', name: 'All jobs' },
      { layout: 'board', name: 'By status' },
      { layout: 'calendar', name: 'Visits' },
      {
        layout: 'form',
        name: 'Request a visit',
        settings: {
          form: {
            ...defaultForm('Request a visit', properties),
            questions: ['job', 'kind', 'visit', 'notes'].map((propertyId) => ({
              propertyId,
              text: properties.find((p) => p.id === propertyId)?.name ?? '',
              description: [],
              required: propertyId === 'job',
              display: 'default' as const,
              logic: null,
            })),
          },
        },
      },
    ],
    rows,
    by: people.admin.id,
  };
}
