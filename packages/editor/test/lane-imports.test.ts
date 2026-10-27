// @vitest-environment node
import { describe, expect, it } from 'vitest';

// The collab server loads these files, so they hold schema only: no React, no app code.
// (Vite needs the glob options written out in each call.)
const lanes = import.meta.glob('../src/lanes/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const blocks = import.meta.glob('../src/blocks/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const specifiers = (source: string) =>
  [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
const isIndex = (path: string) => path.endsWith('/index.ts');

describe('schema files', () => {
  it.each(Object.entries(lanes))('%s imports only @tiptap/core and @tiptap/pm', (path, source) => {
    for (const specifier of specifiers(source)) {
      expect(specifier).toMatch(
        isIndex(path) ? /^(@tiptap\/core|\.\/[\w-]+)$/ : /^@tiptap\/(core|pm(\/[\w-]+)?)$/,
      );
    }
  });

  it.each(Object.entries(blocks))('%s imports only Tiptap schema packages', (path, source) => {
    for (const specifier of specifiers(source)) {
      expect(specifier).toMatch(
        isIndex(path) ? /^(@tiptap\/core|\.\/[\w-]+)$/ : /^@tiptap\/(?!react)[\w-]+(\/[\w-]+)?$/,
      );
    }
  });

  it('finds the files', () => {
    expect(Object.keys(lanes).length).toBeGreaterThan(1);
    expect(Object.keys(blocks).length).toBeGreaterThan(1);
  });
});
