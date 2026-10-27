// @vitest-environment node
import { describe, expect, it } from 'vitest';
import claude from '../src/lanes/claude.ts?raw';
import databases from '../src/lanes/databases.ts?raw';
import forms from '../src/lanes/forms.ts?raw';
import learning from '../src/lanes/learning.ts?raw';
import meetings from '../src/lanes/meetings.ts?raw';

const lanes = Object.entries({ claude, databases, forms, learning, meetings });
const specifiers = (source: string) =>
  [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);

describe('lane files', () => {
  it.each(lanes)('%s imports only @tiptap/core and @tiptap/pm', (_lane, source) => {
    for (const specifier of specifiers(source)) {
      expect(specifier).toMatch(/^@tiptap\/(core|pm(\/[\w-]+)?)$/);
    }
  });
});
