import { describe, expect, it } from 'vitest';
import { screens as databases } from './databases/screens.js';
import { screens as forms } from './forms/screens.js';
import { screens as learning } from './learning/screens.js';
import { screens, type Screen } from './screens.js';
import { screens as team } from './team/screens.js';

const lanes: Record<string, Screen[]> = { learning, databases, forms, team };

describe('screens.ts', () => {
  it('names every screen once, in kebab-case, with a path from the site root', () => {
    expect(screens.length).toBeGreaterThan(0);
    expect(new Set(screens.map(({ name }) => name)).size).toBe(screens.length);
    for (const { name, path } of screens) {
      expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(path).toMatch(/^\//);
    }
  });

  it('includes the screens of every lane, named after the lane', () => {
    for (const [lane, list] of Object.entries(lanes)) {
      for (const screen of list) {
        expect(screen.name).toMatch(new RegExp(`^${lane}-`));
        expect(screens).toContain(screen);
      }
    }
  });
});
