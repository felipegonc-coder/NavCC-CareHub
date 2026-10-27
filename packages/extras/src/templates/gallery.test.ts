import { describe, expect, it } from 'vitest';
import {
  describeContents,
  galleryCategories,
  matchesSearch,
  searchTemplates,
  STARTER_CATEGORIES,
  WORKSPACE_CATEGORY,
  type TemplateCard,
} from './gallery';

function card(id: string, name: string, category: string, extra: Partial<TemplateCard> = {}) {
  const base: TemplateCard = {
    id,
    kind: 'starter',
    name,
    description: '',
    category,
    icon: null,
    by: 'Care Hub',
    contents: { subPages: 0, databases: 0, sampleRows: 0 },
    audience: { type: 'everyone' },
    hidden: false,
    canManage: false,
  };
  return { ...base, ...extra };
}

const cards = [
  card('weekly-huddle', 'Weekly huddle', 'Meetings', { description: 'Wins, blockers, shout-outs' }),
  card('meeting-notes', 'Meeting notes', 'Meetings', { description: 'Agenda and action items' }),
  card('shift-handover', 'Shift handover', 'Support', {
    description: 'Open tickets for the next shift',
  }),
  card('a3', 'Escalation playbook', 'Escalations', { kind: 'workspace', by: 'Sam Ortiz' }),
];

describe('describeContents', () => {
  it('lists sub-pages, databases and sample rows', () => {
    expect(describeContents({ subPages: 3, databases: 1, sampleRows: 6 })).toBe(
      '3 sub-pages, 1 database with 6 sample rows',
    );
    expect(describeContents({ subPages: 1, databases: 2, sampleRows: 0 })).toBe(
      '1 sub-page, 2 databases',
    );
    expect(describeContents({ subPages: 0, databases: 0, sampleRows: 0 })).toBe('Just this page');
  });
});

describe('search', () => {
  it('looks at names, descriptions and categories, every word, any case and accent', () => {
    expect(matchesSearch(cards[0]!, 'MEETING')).toBe(true);
    expect(matchesSearch(cards[0]!, 'huddle blockers')).toBe(true);
    expect(matchesSearch(cards[2]!, 'support next')).toBe(true);
    expect(matchesSearch(cards[2]!, 'support huddle')).toBe(false);
    expect(matchesSearch({ name: 'Reunión', description: '', category: 'Team' }, 'reunion')).toBe(
      true,
    );
    expect(matchesSearch(cards[1]!, '   ')).toBe(true);
  });

  it('puts names that start with the search first', () => {
    expect(searchTemplates(cards, 'meeting').map((found) => found.id)).toEqual([
      'meeting-notes',
      'weekly-huddle',
    ]);
    expect(searchTemplates(cards, '')).toHaveLength(4);
  });
});

describe('categories', () => {
  it('lists Made in this workspace, then Care Hub categories, then typed ones', () => {
    expect(galleryCategories(cards)).toEqual([
      WORKSPACE_CATEGORY,
      ...STARTER_CATEGORIES,
      'Escalations',
    ]);
    expect(galleryCategories(cards.slice(0, 2))[0]).toBe('Meetings');
  });
});
