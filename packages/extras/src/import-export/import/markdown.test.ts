import { describe, expect, it } from 'vitest';
import {
  cleanPath,
  linkTarget,
  markdownImporter,
  planMarkdown,
  textAsMarkdown,
  type MarkdownEntry,
} from './markdown';
import { planLink, type ImportInput, type ImportPlan } from './plan';

const markdownOf = (plan: ImportPlan, title: string) => {
  const content = plan.pages.find((page) => page.title === title)?.content;
  return content && 'markdown' in content ? content.markdown : undefined;
};

/** IE-01's zip: a folder, two pictures and links both ways (tests/e2e/flows/import-export). */
const handbook: MarkdownEntry[] = [
  {
    path: 'Intake guide.md',
    text: '# Intake guide\n\nRead [Escalation steps](Escalations/Escalation%20steps.md) first.\n\n![Front desk](front-desk.png)\n',
  },
  { path: 'front-desk.png' },
  {
    path: 'Escalations/Escalation steps.md',
    text: '# Escalation steps\n\nStart from the [Intake guide](../Intake%20guide.md).\n\n![Phone tree](phone-tree.png)\n',
  },
  { path: 'Escalations/phone-tree.png' },
];

describe('planMarkdown', () => {
  it('makes the page tree, with links between the files and their pictures', () => {
    const plan = planMarkdown(handbook);
    const tree = plan.pages.map((page) => {
      const parent = plan.pages.find((other) => other.key === page.parent);
      return parent ? `${parent.title}/${page.title}` : page.title;
    });
    expect(tree).toEqual(['Escalations', 'Escalations/Escalation steps', 'Intake guide']);
    expect(plan.files.map((file) => [file.name, file.entry])).toEqual([
      ['phone-tree.png', 'Escalations/phone-tree.png'],
      ['front-desk.png', 'front-desk.png'],
    ]);
    const key = (title: string) => plan.pages.find((page) => page.title === title)?.key ?? '';
    const file = (name: string) => plan.files.find((f) => f.name === name)?.key ?? '';
    expect(markdownOf(plan, 'Intake guide')).toBe(
      `\nRead [Escalation steps](${planLink(key('Escalation steps'))}) first.\n\n![Front desk](${planLink(file('front-desk.png'))})\n`,
    );
    expect(markdownOf(plan, 'Escalation steps')).toContain(
      `[Intake guide](${planLink(key('Intake guide'))})`,
    );
    expect(plan.problems).toEqual([]);
  });

  it('makes "X.md" next to a folder "X" that folder\'s page', () => {
    const plan = planMarkdown([
      { path: 'Team.md', text: 'About the team' },
      { path: 'Team/Shifts.md', text: 'Mornings' },
    ]);
    expect(plan.pages.map((page) => [page.title, page.parent === null])).toEqual([
      ['Team', true],
      ['Shifts', false],
    ]);
    expect(markdownOf(plan, 'Team')).toBe('About the team');
  });

  it('lists what it leaves out', () => {
    const plan = planMarkdown([
      { path: 'Notes.md', text: 'Hi' },
      { path: 'setup.exe' },
      { path: 'old.zip' },
      { path: '../outside.md', text: 'No' },
      { path: '__MACOSX/._Notes.md', text: '' },
      { path: '.DS_Store' },
      { path: 'unused.png' },
    ]);
    expect(plan.pages.map((page) => page.title)).toEqual(['Notes']);
    expect(plan.problems).toEqual([
      { file: 'setup.exe', what: 'Refused', why: "Programs can't be imported." },
      { file: 'old.zip', what: 'Skipped', why: "Zips inside zips aren't opened." },
      { file: '../outside.md', what: 'Skipped', why: 'Its path points outside the zip.' },
      { file: 'unused.png', what: 'Skipped', why: 'No page links to it.' },
    ]);
  });

  it('refuses Mac installers by their name', () => {
    const plan = planMarkdown([
      { path: 'Notes.md', text: 'Hi' },
      { path: 'Installer.dmg' },
      { path: 'tool.pkg' },
    ]);
    expect(plan.problems).toEqual([
      { file: 'Installer.dmg', what: 'Refused', why: "Programs can't be imported." },
      { file: 'tool.pkg', what: 'Refused', why: "Programs can't be imported." },
    ]);
  });

  it('leaves code, other sites and anchors alone', () => {
    const plan = planMarkdown([
      {
        path: 'a.md',
        text: '[site](https://example.org/b.md) [top](#top)\n\n```\n[b](b.md)\n```\n\n[b][ref]\n\n[ref]: <b.md>',
      },
      { path: 'b.md', text: 'B' },
    ]);
    const b = plan.pages.find((page) => page.title === 'b')?.key ?? '';
    expect(markdownOf(plan, 'a')).toBe(
      `[site](https://example.org/b.md) [top](#top)\n\n\`\`\`\n[b](b.md)\n\`\`\`\n\n[b][ref]\n\n[ref]: ${planLink(b)}`,
    );
  });

  it('reads text files as plain text, titled by their name', () => {
    const plan = planMarkdown([
      { path: 'Call notes.txt', text: '# not a heading\n*plain*\n\nNext' },
    ]);
    expect(plan.pages[0]?.title).toBe('Call notes');
    expect(markdownOf(plan, 'Call notes')).toBe('\\# not a heading\\\n\\*plain\\*\n\nNext');
  });

  it('cuts pages that are too long and says so', () => {
    const plan = planMarkdown([{ path: 'Long.md', text: 'x'.repeat(1_000_001) }]);
    expect(markdownOf(plan, 'Long')).toHaveLength(1_000_000);
    expect(plan.problems).toEqual([
      { file: 'Long.md', what: 'Cut short', why: 'Pages can have up to 1,000,000 characters.' },
    ]);
  });
});

describe('paths', () => {
  it('keeps paths inside the zip', () => {
    expect(cleanPath('a/./b/../c.md')).toBe('a/c.md');
    expect(cleanPath('a\\b.md')).toBe('a/b.md');
    expect(cleanPath('../a.md')).toBeNull();
    expect(cleanPath('/etc/passwd')).toBeNull();
    expect(cleanPath('C:/x.md')).toBeNull();
  });

  it('follows relative links only', () => {
    expect(linkTarget('a/b.md', '../c%20d.md#part')).toBe('c d.md');
    expect(linkTarget('a/b.md', 'pic.png?x=1')).toBe('a/pic.png');
    expect(linkTarget('a.md', 'mailto:sam@example.org')).toBeNull();
    expect(linkTarget('a.md', '/root.md')).toBeNull();
    expect(linkTarget('a.md', '../../x.md')).toBeNull();
  });

  it('escapes text so it reads back the same', () => {
    expect(textAsMarkdown('1. a [b]\nc')).toBe('1\\. a \\[b\\]\\\nc');
  });
});

describe('markdownImporter', () => {
  const zipInput = (entries: Record<string, string>): ImportInput => ({
    fileName: 'notes.zip',
    bytes: new Uint8Array(),
    text: async () => '',
    zip: {
      names: Object.keys(entries),
      read: async () => new Uint8Array(),
      text: async (name) => entries[name] ?? '',
    },
  });

  it('reads a zip, opening only its documents', async () => {
    const read: string[] = [];
    const input = zipInput({ 'a.md': '# A', 'b.png': '', '__MACOSX/._a.md': '' });
    const zip = input.zip;
    if (!zip) throw new Error('no zip');
    const text = zip.text;
    zip.text = async (name) => {
      read.push(name);
      return text(name);
    };
    const plan = await markdownImporter.plan(input);
    expect(read).toEqual(['a.md']);
    expect(plan.pages.map((page) => page.title)).toEqual(['A']);
  });

  it('reads a single file', async () => {
    const plan = await markdownImporter.plan({
      fileName: 'Intake guide.md',
      bytes: new Uint8Array(),
      text: async () => 'Welcome',
      zip: null,
    });
    expect(plan.pages.map((page) => [page.title, page.content])).toEqual([
      ['Intake guide', { markdown: 'Welcome' }],
    ]);
  });

  it('stops when there is nothing to import', async () => {
    await expect(markdownImporter.plan(zipInput({ 'a.png': '' }))).rejects.toThrow(
      'there are no Markdown or text files in it',
    );
  });
});
