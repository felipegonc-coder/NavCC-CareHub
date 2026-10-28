import {
  checkPlan,
  planLink,
  type ImportZip,
  type PlanNode,
} from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { googleDocsImporter, partPath, wordImporter } from './word-importer';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006/relationships';

const rels = (...items: string[]) =>
  `<Relationships xmlns="${PACKAGE}">${items.join('')}</Relationships>`;
const rel = (id: string, type: string, target: string, external = false) =>
  `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${
    external ? ' TargetMode="External"' : ''
  }/>`;
const part = (root: string, inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><w:${root} xmlns:w="${W}" xmlns:r="${R}" ` +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
  `${inner}</w:${root}>`;

const docx: Record<string, string> = {
  '[Content_Types].xml': '<Types/>',
  '_rels/.rels': rels(rel('rId1', 'officeDocument', 'word/document.xml')),
  'word/_rels/document.xml.rels': rels(
    rel('rId1', 'styles', 'styles.xml'),
    rel('rId2', 'image', 'media/front%20desk.png'),
    rel('rId3', 'hyperlink', 'https://example.test/intake', true),
    rel('rId4', 'hyperlink', 'javascript:alert(1)', true),
  ),
  'word/styles.xml': part(
    'styles',
    '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
  ),
  'word/document.xml': part(
    'document',
    '<w:body>' +
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Intake guide</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t xml:space="preserve">Fill in </w:t></w:r>' +
      '<w:hyperlink r:id="rId3"><w:r><w:t>the form</w:t></w:r></w:hyperlink>' +
      '<w:r><w:t xml:space="preserve">, not </w:t></w:r>' +
      '<w:hyperlink r:id="rId4"><w:r><w:t>this</w:t></w:r></w:hyperlink></w:p>' +
      '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1"/><a:graphic>' +
      '<a:graphicData><a:blip r:embed="rId2"/></a:graphicData></a:graphic></wp:inline>' +
      '</w:drawing></w:r></w:p>' +
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Mon</w:t></w:r></w:p></w:tc>' +
      '<w:tc><w:p><w:r><w:t>Avery</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
      '<w:sectPr/></w:body>',
  ),
  'word/media/front desk.png': '',
  'word/media/unused.png': '',
};

function zipOf(entries: Record<string, string>): ImportZip {
  return {
    names: Object.keys(entries),
    read: async () => new Uint8Array(),
    text: async (name) => entries[name] ?? '',
  };
}

const inputFor = (zip: ImportZip | null, fileName = 'Intake.docx') => ({
  fileName,
  bytes: new Uint8Array(),
  text: async () => '',
  zip,
  options: {},
});

const texts = (node: PlanNode): string[] =>
  node.text !== undefined ? [node.text] : (node.content ?? []).flatMap(texts);

describe('Word import', () => {
  it('makes one page with the headings, links, pictures and tables, and the pictures as files', async () => {
    const plan = await wordImporter.plan(inputFor(zipOf(docx)));
    checkPlan(plan);
    expect(plan.files).toEqual([
      { key: 'f1', name: 'front desk.png', entry: 'word/media/front desk.png' },
    ]);
    const [page] = plan.pages;
    expect(page).toMatchObject({
      key: 'p1',
      parent: null,
      title: 'Intake guide',
      source: 'Intake.docx',
    });
    const doc = page && 'doc' in page.content ? page.content.doc : null;
    expect(doc?.content?.map((node) => [node.type, texts(node).join('')])).toEqual([
      ['paragraph', 'Fill in the form, not this'],
      ['paragraph', 'front desk.png'],
      ['paragraph', 'Mon | Avery'],
    ]);
    const marks = doc?.content?.flatMap((node) => node.content ?? []).map((node) => node.marks);
    expect(marks).toEqual([
      undefined,
      [{ type: 'link', attrs: { href: 'https://example.test/intake' } }],
      undefined,
      [{ type: 'link', attrs: { href: planLink('f1') } }],
      undefined,
      undefined,
      undefined,
    ]);
    expect(plan.problems.map((problem) => problem.what)).toEqual([
      '1 picture kept as a link',
      '1 table kept as text',
    ]);
    expect(plan.databases).toEqual([]);
  });

  it('is titled by the file name without a heading first, for Google Docs too', async () => {
    const body = part('document', '<w:body><w:p><w:r><w:t>Welcome</w:t></w:r></w:p></w:body>');
    const zip = zipOf({ 'word/document.xml': body });
    const plan = await googleDocsImporter.plan(inputFor(zip, 'Front desk notes.docx'));
    expect(googleDocsImporter.source).toBe('google-docs');
    expect(plan.pages.map((page) => page.title)).toEqual(['Front desk notes']);
  });

  it("says when the file isn't a Word document, or is damaged", async () => {
    await expect(wordImporter.plan(inputFor(null))).rejects.toThrow("this isn't a Word document");
    await expect(wordImporter.plan(inputFor(zipOf({ 'a.txt': 'hi' })))).rejects.toThrow(
      "this isn't a Word document",
    );
    const damaged = zipOf({ 'word/document.xml': '<w:document><w:body>' });
    await expect(wordImporter.plan(inputFor(damaged))).rejects.toThrow(
      "this isn't a Word document",
    );
  });

  it('finds parts from their relationships, never outside the zip', () => {
    expect(partPath('word', 'media/image1.png')).toBe('word/media/image1.png');
    expect(partPath('word', '../customXml/item1.xml')).toBe('customXml/item1.xml');
    expect(partPath('word', '/word/media/a%20b.png')).toBe('word/media/a b.png');
    expect(partPath('', 'word/document.xml')).toBe('word/document.xml');
    expect(partPath('word', '../../secret.txt')).toBeNull();
  });
});
