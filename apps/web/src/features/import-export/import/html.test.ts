import type { PlanNode } from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { htmlToContent } from './html';

// The page schema's rules (packages/editor/src/schema.ts), which the server checks again.
const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'codeBlock'];
const isBlock = (node: PlanNode) => [...BLOCKS, 'blockquote', 'horizontalRule'].includes(node.type);
const isInline = (node: PlanNode) => node.type === 'text' || node.type === 'hardBreak';
const CONTENT: Record<string, (content: PlanNode[]) => boolean> = {
  doc: (content) => content.length > 0 && content.every(isBlock),
  paragraph: (content) => content.every(isInline),
  heading: (content) => content.every(isInline),
  bulletList: (content) => content.length > 0 && content.every((n) => n.type === 'listItem'),
  orderedList: (content) => content.length > 0 && content.every((n) => n.type === 'listItem'),
  taskList: (content) => content.length > 0 && content.every((n) => n.type === 'taskItem'),
  listItem: (content) => content[0]?.type === 'paragraph' && content.every(isBlock),
  taskItem: (content) => content[0]?.type === 'paragraph' && content.every(isBlock),
  blockquote: (content) => content.length > 0 && content.every(isBlock),
  codeBlock: (content) => content.every((n) => n.type === 'text' && !n.marks),
  horizontalRule: (content) => content.length === 0,
  hardBreak: (content) => content.length === 0,
  text: (content) => content.length === 0,
};
const ATTRS: Record<string, string[]> = {
  heading: ['level'],
  orderedList: ['start', 'type'],
  taskItem: ['checked'],
  codeBlock: ['language'],
};
const MARKS = ['bold', 'italic', 'underline', 'strike', 'code', 'link'];

/** Throws unless the node fits the page schema; gives how deep it goes. */
function check(node: PlanNode): number {
  const fits = CONTENT[node.type];
  if (!fits?.(node.content ?? [])) throw new Error(`${node.type} doesn't fit the schema`);
  for (const name of Object.keys(node.attrs ?? {})) {
    if (!ATTRS[node.type]?.includes(name)) throw new Error(`${node.type} has ${name}`);
  }
  if (node.type === 'heading' && ![1, 2, 3].includes(node.attrs?.level as number)) {
    throw new Error('heading level');
  }
  if (node.type === 'text' && !node.text) throw new Error('empty text');
  const marks = (node.marks ?? []).map((mark) => mark.type);
  if (new Set(marks).size < marks.length || marks.some((mark) => !MARKS.includes(mark))) {
    throw new Error(`marks ${marks.join()}`);
  }
  if (marks.includes('code') && marks.length > 1) throw new Error('code with other marks');
  for (const mark of node.marks ?? []) {
    if (Object.keys(mark.attrs ?? {}).some((name) => name !== 'href')) throw new Error('link');
  }
  return 1 + Math.max(0, ...(node.content ?? []).map(check));
}

function read(html: string, link: (href: string) => string | null = (href) => href) {
  const { content, problems } = htmlToContent(html, { source: 'Notes/Trip.html', link });
  if (!('doc' in content)) throw new Error('not a document');
  const depth = check(content.doc);
  return { blocks: content.doc.content ?? [], problems, depth };
}

const blocks = (html: string, link?: (href: string) => string | null) => read(html, link).blocks;
const text = (value: string, ...marks: string[]): PlanNode => ({
  type: 'text',
  text: value,
  ...(marks.length && { marks: marks.map((type) => ({ type })) }),
});
const link = (value: string, href: string): PlanNode => ({
  type: 'text',
  text: value,
  marks: [{ type: 'link', attrs: { href } }],
});
const p = (...content: PlanNode[]): PlanNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const br: PlanNode = { type: 'hardBreak' };
const item = (...content: PlanNode[]): PlanNode => ({ type: 'listItem', content });
const bullets = (...content: PlanNode[]): PlanNode => ({ type: 'bulletList', content });

describe('htmlToContent', () => {
  it('reads paragraphs, headings and marks', () => {
    expect(
      blocks(
        '<h1>Trip</h1><h4>Day <em>one</em></h4><h2 data-level="1">Copied</h2>' +
          '<p>Pack <b>light</b>, <i>early</i>, <u>neat</u>, <s>heavy</s> and <code>x</code>.</p>',
      ),
    ).toEqual([
      { type: 'heading', attrs: { level: 1 }, content: [text('Trip')] },
      { type: 'heading', attrs: { level: 3 }, content: [text('Day '), text('one', 'italic')] },
      { type: 'heading', attrs: { level: 1 }, content: [text('Copied')] },
      p(
        text('Pack '),
        text('light', 'bold'),
        text(', '),
        text('early', 'italic'),
        text(', '),
        text('neat', 'underline'),
        text(', '),
        text('heavy', 'strike'),
        text(' and '),
        text('x', 'code'),
        text('.'),
      ),
    ]);
  });

  it('reads marks from styles, as Word and Google Docs write them', () => {
    const html =
      '<b style="font-weight:normal" id="docs-internal-guid-1"><p>' +
      '<span style="font-weight:700">B</span><span style="font-style: italic">I</span>' +
      '<span style="text-decoration: underline line-through">US</span>' +
      '<strong style="font-weight: 400">plain</strong><a href="https://example.com">' +
      '<span style="text-decoration:underline">L</span></a></p></b>';
    expect(blocks(html)).toEqual([
      p(
        text('B', 'bold'),
        text('I', 'italic'),
        text('US', 'underline', 'strike'),
        text('plain'),
        link('L', 'https://example.com'),
      ),
    ]);
  });

  it('keeps the code mark alone, and a link over it', () => {
    expect(
      blocks(
        '<p><code><b>k</b></code> <b><a href="https://example.com/x"><code>c</code></a></b></p>',
      ),
    ).toEqual([
      p(text('k', 'code'), text(' '), {
        type: 'text',
        text: 'c',
        marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.com/x' } }],
      }),
    ]);
  });

  it('collapses spaces outside code blocks and keeps line breaks', () => {
    expect(
      blocks(
        '<p>  Bring \n  water <br>  and   food  </p><div><br></div><p></p><p>a<br></p>' +
          '<pre>  x &lt; 1\n    y\n</pre><p>a\u0001b\uFEFF\u00a0</p>',
      ),
    ).toEqual([
      p(text('Bring water'), br, text('and food')),
      p(),
      p(text('a')),
      { type: 'codeBlock', content: [text('  x < 1\n    y')] },
      p(text('ab\u00a0')),
    ]);
  });

  it('reads code blocks as plain text with their language', () => {
    expect(
      blocks(
        '<pre><code class="language-TypeScript">let <b>a</b> = 1;<br>done</code></pre>' +
          '<pre data-language="sql"><div>select 1</div><div>from t</div></pre><pre></pre>',
      ),
    ).toEqual([
      { type: 'codeBlock', attrs: { language: 'typescript' }, content: [text('let a = 1;\ndone')] },
      { type: 'codeBlock', attrs: { language: 'sql' }, content: [text('select 1\nfrom t')] },
      { type: 'codeBlock' },
    ]);
  });

  it('reads bulleted and numbered lists, nested ones and lists right inside lists', () => {
    expect(
      blocks(
        '<ul><li>a<ul><li>b</li></ul></li></ul><ol start="3" type="A"><li><p>c</p></li></ol>' +
          '<ul><li>d</li><ul><li>e</li></ul></ul><ol><li>f</li></ol>',
      ),
    ).toEqual([
      bullets(item(p(text('a')), bullets(item(p(text('b')))))),
      { type: 'orderedList', attrs: { start: 3, type: 'a' }, content: [item(p(text('c')))] },
      bullets(item(p(text('d')), bullets(item(p(text('e')))))),
      { type: 'orderedList', content: [item(p(text('f')))] },
    ]);
  });

  it('starts every list item with a paragraph', () => {
    expect(blocks('<ul><li><h3>Head</h3><p>t</p></li><li><pre>c</pre></li><li></li></ul>')).toEqual(
      [
        bullets(
          item(p(text('Head')), p(text('t'))),
          item(p(), { type: 'codeBlock', content: [text('c')] }),
          item(p()),
        ),
      ],
    );
  });

  it("reads to-dos from Care Hub's task lists and from checkboxes", () => {
    const html =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label>' +
      '<input type="checkbox" checked><span></span></label><div><p>Done</p></div></li></ul>' +
      '<ul><li><input type="checkbox"> Open</li><li><input type="CHECKBOX" checked> Shut</li></ul>';
    const task = (checked: boolean, value: string) => ({
      type: 'taskItem',
      attrs: { checked },
      content: [p(text(value))],
    });
    expect(blocks(html)).toEqual([
      { type: 'taskList', content: [task(true, 'Done')] },
      { type: 'taskList', content: [task(false, 'Open'), task(true, 'Shut')] },
    ]);
  });

  it('reads quotes, dividers, and blocks inside links and marks', () => {
    expect(
      blocks(
        '<blockquote><p>Quote</p></blockquote><blockquote> </blockquote><hr>' +
          '<a href="https://example.com"><div>Linked</div></a><b><p>Bold</p></b>',
      ),
    ).toEqual([
      { type: 'blockquote', content: [p(text('Quote'))] },
      { type: 'horizontalRule' },
      p(link('Linked', 'https://example.com')),
      p(text('Bold', 'bold')),
    ]);
  });

  it("links where the importer says, and drops links that aren't safe", () => {
    const targets: Record<string, string | null> = {
      'Other%20page.html': 'carehub-import:page-2',
      'gone.html': null,
      'evil.html': 'javascript:alert(1)',
      '//cdn.example.com/a': '//cdn.example.com/a',
      'mailto:ana@example.com': 'mailto:ana@example.com',
    };
    const html =
      '<p><a href="Other%20page.html">Other</a> <a href="gone.html">Gone</a> ' +
      '<a href="evil.html">Evil</a> <a href="//cdn.example.com/a">CDN</a> ' +
      '<a href="mailto:ana@example.com">Ana</a> <a name="top">Top</a></p>';
    expect(blocks(html, (href) => targets[href] ?? null)).toEqual([
      p(
        link('Other', 'carehub-import:page-2'),
        text(' Gone Evil '),
        link('CDN', 'https://cdn.example.com/a'),
        text(' '),
        link('Ana', 'mailto:ana@example.com'),
        text(' Top'),
      ),
    ]);
  });

  it('keeps pictures as links named by their alt text or file, and lists them', () => {
    const files: Record<string, string> = {
      'images/Beach%20day.png': 'carehub-import:file-1',
      'map.png': 'carehub-import:file-2',
    };
    const { blocks: read1, problems } = read(
      '<p><img src="images/Beach%20day.png"> <a href="https://example.com"><img alt="Map" ' +
        'src="map.png"></a></p><p><img src="gone.png"><img src="https://t.example/p.gif" ' +
        'width="1" height="1"></p><figure><img src="data:image/png;base64,AAAA"></figure>',
      (href) => files[href] ?? null,
    );
    expect(read1).toEqual([
      p(
        link('Beach day.png', 'carehub-import:file-1'),
        text(' '),
        link('Map', 'carehub-import:file-2'),
      ),
    ]);
    expect(problems).toEqual([
      {
        file: 'Notes/Trip.html',
        what: 'Kept as links',
        why: "2 pictures. Pages can't show pictures yet.",
      },
      { file: 'Notes/Trip.html', what: 'Left out', why: "2 pictures. Their files weren't found." },
    ]);
  });

  it('keeps tables as a line for each row, and rows with one cell as they are', () => {
    const { blocks: read1, problems } = read(
      '<table><caption>Plan</caption><thead><tr><th>Day</th><th>Place</th></tr></thead>' +
        '<tbody><tr><td>Mon</td><td><b>Paris</b><br>Lyon</td></tr><tr><td></td><td>Nice</td>' +
        '</tr></tbody></table><table><tr><td><ul><li>Layout</li></ul></td></tr></table>',
    );
    expect(read1).toEqual([
      p(text('Plan')),
      p(text('Day'), text(' | '), text('Place')),
      p(text('Mon'), text(' | '), text('Paris', 'bold'), br, text('Lyon')),
      p(text('Nice')),
      bullets(item(p(text('Layout')))),
    ]);
    expect(problems).toEqual([
      {
        file: 'Notes/Trip.html',
        what: 'Kept as text',
        why: "1 table, a line for each row. Pages can't show tables yet.",
      },
    ]);
  });

  it('keeps callouts as quotes that start with their icon', () => {
    const { blocks: read1, problems } = read(
      '<aside class="callout"><span class="callout-icon">💡</span><div class="callout-body">' +
        '<p>Bring <b>water</b></p></div></aside><aside class="callout"><div class="callout-body">' +
        '<ul><li>Hat</li></ul></div><span class="callout-icon">!</span></aside>',
    );
    expect(read1).toEqual([
      { type: 'blockquote', content: [p(text('💡 '), text('Bring '), text('water', 'bold'))] },
      { type: 'blockquote', content: [p(text('!')), bullets(item(p(text('Hat'))))] },
    ]);
    expect(problems.map((problem) => problem.what)).toEqual(['Kept as quotes']);
  });

  it('leaves out scripts, styles, hidden content and controls, and lists videos and frames', () => {
    const { blocks: read1, problems } = read(
      '<html><head><title>T</title><style>p{}</style></head><body><script>alert(1)</script>' +
        '<p hidden>h</p><p style="color:red; display: none">h</p><p>Keep<input value="v">' +
        '<button>b</button><svg><text>s</text></svg></p><iframe src="https://example.com">' +
        '</iframe><video src="v.mp4"></video><noscript>Turn on JavaScript</noscript></body></html>',
    );
    expect(read1).toEqual([p(text('Keep'))]);
    expect(problems).toEqual([
      {
        file: 'Notes/Trip.html',
        what: 'Left out',
        why: "2 videos, sounds or frames. Pages can't show them yet.",
      },
    ]);
  });

  it('leaves out empty lines at the start and end, and gives an empty page one', () => {
    expect(blocks('<div><br></div><p>a</p><p><br></p><p>b</p><br>')).toEqual([
      p(text('a')),
      p(),
      p(text('b')),
    ]);
    expect(blocks('')).toEqual([p()]);
    expect(blocks('<!-- nothing --><div> </div><br>')).toEqual([p()]);
  });

  it("stays within the server's depth for very deep lists and quotes", () => {
    const deep = (open: string, close: string, n: number) =>
      `${open.repeat(n)}Deep${close.repeat(n)}`;
    for (const html of [
      deep('<ul><li>', '</li></ul>', 200),
      deep('<blockquote>', '</blockquote>', 200),
      deep('<span>', '</span>', 2000),
    ]) {
      const result = read(html);
      expect(result.depth).toBeLessThanOrEqual(100);
      expect(JSON.stringify(result.blocks)).toContain('"Deep"');
    }
  });
});
