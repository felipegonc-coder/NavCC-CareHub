import { readVariable } from '@carehub/extras/templates/content';
import { readableIds } from '@carehub/extras/templates/databases';
import { STARTER_CATEGORIES, TEMPLATE_LIMITS } from '@carehub/extras/templates/gallery';
import { templateIdSchema } from '@carehub/extras/templates/schemas';
import { describe, expect, it } from 'vitest';
import { STARTERS, STARTERS_BY_KEY, type StarterPage } from './starters';

const pagesOf = (page: StarterPage): StarterPage[] => [
  page,
  ...(page.children ?? []).flatMap(pagesOf),
];

describe('starter templates', () => {
  it('have unique keys that work as template IDs', () => {
    const keys = STARTERS.map((starter) => starter.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(templateIdSchema.safeParse(key).success).toBe(true);
  });

  it('use Care Hub categories and fit the limits', () => {
    for (const starter of STARTERS) {
      expect(STARTER_CATEGORIES as readonly string[]).toContain(starter.category);
      expect(starter.name.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.name);
      expect(starter.description.length).toBeLessThanOrEqual(TEMPLATE_LIMITS.description);
      expect(starter.description).toMatch(/\.$/);
    }
  });

  it('only hold variable chips the gallery knows', () => {
    for (const starter of STARTERS) {
      for (const page of pagesOf(starter.page)) {
        for (const [, json] of page.markdown.matchAll(/<!-- carehub:inline (\{.*?\}) -->/g)) {
          expect(readVariable(JSON.parse(json ?? '{}'))).not.toBeNull();
        }
        expect(page.markdown).not.toMatch(/https?:\/\//);
      }
    }
  });

  it('only link to their own pages, never to themselves', () => {
    for (const starter of STARTERS) {
      const pages = pagesOf(starter.page);
      pages.forEach((page, key) => {
        for (const [, linked] of page.markdown.matchAll(/\/p\/\{\{template-page:(\d+)\}\}/g)) {
          expect(Number(linked)).toBeLessThan(pages.length);
          expect(Number(linked)).not.toBe(key);
        }
        expect(page.markdown.replace(/\/p\/\{\{template-page:\d+\}\}/g, '')).not.toMatch(/\{\{/);
      });
    }
  });

  it('cover every Care Hub category', () => {
    const used = new Set(STARTERS.map((starter) => starter.category));
    for (const category of STARTER_CATEGORIES) expect(used.has(category)).toBe(true);
  });

  it('are the ones in spec 3.1, with the Customer Care starters under Support (TB-17)', () => {
    expect(new Set(STARTERS.map((starter) => starter.name))).toEqual(
      new Set([
        'Meeting notes',
        'Weekly huddle',
        '1:1 notes',
        'Project brief',
        'Project tracker',
        'Task board',
        'Decision record',
        'How-to guide',
        'Policy page',
        'Team wiki',
        'New hire onboarding',
        'Incident review',
        'Shift handover',
        'Content calendar',
        'Request form',
        'Feedback form',
        'Event sign-up',
        'Agents',
        'QA reviews',
        'Coaching conversations',
      ]),
    );
    const support = STARTERS.filter((starter) => starter.category === 'Support');
    expect(support.map((starter) => starter.name)).toEqual([
      'Shift handover',
      'Incident review',
      'Agents',
      'QA reviews',
      'Coaching conversations',
    ]);
  });

  it('make databases for the database and form starters', () => {
    const databases = STARTERS.filter((starter) => starter.page.database);
    expect(databases.map((starter) => starter.key)).toEqual([
      'project-tracker',
      'task-board',
      'content-calendar',
      'request-form',
      'feedback-form',
      'event-sign-up',
      'agents',
      'qa-reviews',
      'coaching-conversations',
    ]);
    for (const starter of databases) {
      const database = starter.page.database?.(readableIds);
      expect(starter.page.children ?? []).toEqual([]);
      expect(starter.page.markdown).toContain(database?.description ?? '');
      if (starter.category === 'Forms') {
        expect(database?.views.some((view) => view.layout === 'form')).toBe(true);
      }
    }
    expect(STARTERS_BY_KEY.get('qa-reviews')?.page.markdown).toContain('Agent → Can view');
  });
});
