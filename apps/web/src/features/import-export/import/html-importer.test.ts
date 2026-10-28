import {
  checkPlan,
  planLink,
  type ImportInput,
  type ImportPlan,
  type ImportZip,
  type PlanContent,
} from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { htmlImporter, htmlTitle } from './html-importer';

const encode = (text: string) => Uint8Array.from(new TextEncoder().encode(text));

const fileInput = (fileName: string, html: string): ImportInput => ({
  fileName,
  bytes: encode(html),
  text: async () => html,
  zip: null,
  options: {},
});

const zipInput = (entries: Record<string, string>): ImportInput => {
  const zip: ImportZip = {
    names: Object.keys(entries),
    read: async (name) => encode(entries[name] ?? ''),
    text: async (name) => entries[name] ?? '',
  };
  return { fileName: 'Site.zip', bytes: new Uint8Array(), text: async () => '', zip, options: {} };
};

interface Node {
  type?: string;
  text?: string;
  marks?: { type: string; attrs?: { href?: string } }[];
  content?: Node[];
}

/** The plan, checked as the server checks it. */
async function planOf(input: ImportInput): Promise<ImportPlan> {
  const plan = await htmlImporter.plan(input);
  checkPlan(plan);
  return plan;
}

/** The page's text, with each link's address after it in brackets. */
function textOf(content: PlanContent | undefined): string {
  const walk = (node: Node): string => {
    const href = node.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
    const own = node.text === undefined ? '' : href ? `${node.text}[${href}]` : node.text;
    return own + (node.content ?? []).map(walk).join(node.type === 'doc' ? '\n' : '');
  };
  return content && 'doc' in content ? walk(content.doc as Node) : '';
}

const tree = (plan: ImportPlan) =>
  plan.pages.map((page) => {
    const parent = plan.pages.find((other) => other.key === page.parent);
    return parent ? `${parent.title}/${page.title}` : page.title;
  });

describe('the HTML importer', () => {
  it('reads an .html file as a page, without its scripts, form controls and frames', async () => {
    const html =
      '<html><head><title>Trip plan</title><script>alert(1)</script></head><body>' +
      '<p>Pack <b>light</b>.</p><form><input name="q"><button>Go</button></form>' +
      '<iframe src="https://example.com/map"></iframe><script>steal()</script></body></html>';
    const plan = await planOf(fileInput('Trip.html', html));
    expect(
      plan.pages.map(({ key, parent, title, source }) => ({ key, parent, title, source })),
    ).toEqual([{ key: 'p1', parent: null, title: 'Trip plan', source: 'Trip.html' }]);
    expect(textOf(plan.pages[0]?.content)).toBe('Pack light.');
    expect(plan.problems).toEqual([
      {
        file: 'Trip.html',
        what: '1 video, sound or frame left out',
        why: "Pages can't show them yet.",
      },
    ]);
  });

  it('reads a zip of pages as a tree, with links between them and the pictures they show', async () => {
    const plan = await planOf(
      zipInput({
        'Site/index.html':
          '<title>Clinic site</title><p>See <a href="visits/hours.html#today">hours</a> and ' +
          '<a href="https://example.com/map">the map</a>.</p><img src="img/front.png" alt="Front">',
        'Site/visits/hours.html': '<h1>Hours</h1><p>Back to <a href="../index.html">home</a>.</p>',
        'Site/img/front.png': 'png',
        'Site/img/old.png': 'png',
        'Site/css/site.css': '',
        'Site/js/app.js': '',
        '__MACOSX/Site/._index.html': '',
      }),
    );
    expect(tree(plan)).toEqual(['Clinic site', 'Clinic site/visits', 'visits/Hours']);
    const key = (title: string) => plan.pages.find((page) => page.title === title)?.key ?? '';
    const content = (title: string) => plan.pages.find((page) => page.title === title)?.content;
    expect(textOf(content('Clinic site'))).toBe(
      `See hours[${planLink(key('Hours'))}] and the map[https://example.com/map].\n` +
        `Front[${planLink('f1')}]`,
    );
    expect(textOf(content('Hours'))).toBe(`Hours\nBack to home[${planLink(key('Clinic site'))}].`);
    expect(plan.files).toEqual([{ key: 'f1', name: 'front.png', entry: 'Site/img/front.png' }]);
    expect(plan.problems).toEqual([
      {
        file: 'Site/index.html',
        what: '1 picture kept as a link',
        why: "Pages can't show pictures yet.",
      },
      { file: 'Site/img/old.png', what: 'Skipped', why: 'No page links to it.' },
      {
        file: 'Site',
        what: '2 style and script files left out',
        why: 'Pages keep what the HTML says, not how it looked or what its scripts did.',
      },
    ]);
  });

  it('refuses a zip without HTML pages', async () => {
    await expect(htmlImporter.plan(zipInput({ 'front.png': 'png' }))).rejects.toThrow(
      'there are no HTML pages in it',
    );
  });

  it('titles a page by its <title>, then its first heading', () => {
    expect(htmlTitle('<title> Trip \n plan </title><h1>Days</h1>')).toBe('Trip plan');
    expect(htmlTitle('<p>Intro</p><h1>Days</h1>')).toBe('Days');
    expect(htmlTitle('<p>Intro</p>')).toBeNull();
  });
});
