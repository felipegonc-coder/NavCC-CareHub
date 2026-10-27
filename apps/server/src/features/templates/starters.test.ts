import { readVariable } from '@carehub/extras/templates/content';
import { STARTER_CATEGORIES, TEMPLATE_LIMITS } from '@carehub/extras/templates/gallery';
import { templateIdSchema } from '@carehub/extras/templates/schemas';
import { describe, expect, it } from 'vitest';
import { STARTERS, type StarterPage } from './starters';

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
});
