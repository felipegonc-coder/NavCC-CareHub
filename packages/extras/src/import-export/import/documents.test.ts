import { describe, expect, it } from 'vitest';
import { planDocuments, type DocumentReader } from './documents';
import { planLink } from './plan';

/** Reads "*.page" documents: the first line is the title, the rest are paths it links to. */
const reader = (more: Partial<DocumentReader> = {}): DocumentReader => ({
  documents: /\.page$/i,
  read(path, text, target) {
    const [title = '', ...links] = text.split('\n');
    const markdown = links.map((to) => `[${to}](${target(to) ?? 'none'})`).join('\n');
    return { title: title || null, content: { markdown }, problems: [] };
  },
  ...more,
});

const tree = (plan: ReturnType<typeof planDocuments>) =>
  plan.pages.map((page) => {
    const parent = plan.pages.find((other) => other.key === page.parent);
    return parent ? `${parent.title}/${page.title}` : page.title;
  });

describe('planDocuments', () => {
  it("makes a folder's page from the document the reader names, unless one sits next to it", () => {
    const entries = [
      { path: 'Site/index.page', text: 'Welcome\nSite/Trips/beach.png' },
      { path: 'Site/Trips/index.page', text: '' },
      { path: 'Site/Trips.page', text: 'All trips' },
      { path: 'Site/Trips/beach.png' },
    ];
    const isFolderPage = (name: string) => name === 'index.page';
    const plan = planDocuments(entries, reader({ isFolderPage }));
    expect(tree(plan)).toEqual(['Welcome', 'Welcome/All trips', 'All trips/index']);
    expect(plan.pages.map((page) => page.source)).toEqual([
      'Site/index.page',
      'Site/Trips.page',
      'Site/Trips/index.page',
    ]);
    expect(tree(planDocuments(entries, reader()))).toEqual([
      'Site',
      'Site/Welcome',
      'Site/All trips',
      'All trips/index',
    ]);
  });

  it('keeps the name each file has in the zip, and lets the reader word the unlinked ones', () => {
    const plan = planDocuments(
      [
        { path: 'Notes\\Visit.page', text: 'Visit\nNotes/map.png\nNotes/gone.png' },
        { path: 'Notes\\map.png' },
        { path: 'Notes\\style.css' },
        { path: 'Notes\\setup.exe' },
      ],
      reader({ unlinked: (paths) => [{ file: paths.join(' '), what: 'Left out', why: 'Look.' }] }),
    );
    expect(plan.files).toEqual([{ key: 'f1', name: 'map.png', entry: 'Notes\\map.png' }]);
    const visit = plan.pages.find((page) => page.title === 'Visit');
    expect(visit?.content).toEqual({
      markdown: `[Notes/map.png](${planLink('f1')})\n[Notes/gone.png](none)`,
    });
    expect(plan.problems).toEqual([
      { file: 'Notes/setup.exe', what: 'Refused', why: "Programs can't be imported." },
      { file: 'Notes/style.css', what: 'Left out', why: 'Look.' },
    ]);
  });
});
