import { describe, expect, it } from 'vitest';
import { readWord } from './word';

const NAMESPACES = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  mc: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  wps: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
};
const declared = Object.entries(NAMESPACES)
  .map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`)
  .join(' ');
const xml = (root: string, inner: string) =>
  new DOMParser().parseFromString(`<w:${root} ${declared}>${inner}</w:${root}>`, 'application/xml');

const p = (inner: string, props = '') => `<w:p>${props && `<w:pPr>${props}</w:pPr>`}${inner}</w:p>`;
const r = (text: string, props = '') =>
  `<w:r>${props && `<w:rPr>${props}</w:rPr>`}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const styled = (id: string) => `<w:pStyle w:val="${id}"/>`;
const style = (id: string, name: string, inner = '', type = 'paragraph') =>
  `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${inner}</w:style>`;
const item = (text: string, numId: number, level = 0) =>
  p(r(text), `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`);

function read(
  body: string,
  parts: { styles?: string; numbering?: string; footnotes?: string } = {},
  links: Record<string, string> = {},
) {
  return readWord(
    {
      document: xml('document', `<w:body>${body}</w:body>`),
      links: new Map(Object.entries(links)),
      styles: parts.styles === undefined ? null : xml('styles', parts.styles),
      numbering: parts.numbering === undefined ? null : xml('numbering', parts.numbering),
      footnotes: parts.footnotes === undefined ? null : xml('footnotes', parts.footnotes),
    },
    'Intake.docx',
  );
}

describe('reading a Word document', () => {
  it('takes headings from heading styles, whatever their ids, and the title from the first', () => {
    const styles = [
      style('Titel', 'Title'),
      style('berschrift1', 'heading 1'),
      style('berschrift2', 'heading 2'),
      style('Kapitel', 'Kapitel', '<w:basedOn w:val="berschrift2"/>'),
      style('Zitat', 'Quote'),
    ].join('');
    const word = read(
      [
        p(r('Intake guide'), styled('Titel')),
        p(r('Before the call'), styled('berschrift1')),
        p(r('Checks'), styled('Kapitel')),
        p(r('Deep'), '<w:outlineLvl w:val="3"/>'),
        p(r('Be kind.'), styled('Zitat')),
        p(r('Always.'), styled('Zitat')),
        p(r('Body')),
      ].join(''),
      { styles },
    );
    expect(word.title).toBe('Intake guide');
    expect(word.html).toBe(
      '<h1>Before the call</h1><h2>Checks</h2><h4>Deep</h4>' +
        '<blockquote><p>Be kind.</p><p>Always.</p></blockquote><p>Body</p>',
    );
    expect(read(p(r('Body')) + p(r('Later'), '<w:outlineLvl w:val="0"/>')).title).toBeNull();
  });

  it('keeps bold, italic, underline and strike, from the text and its character style', () => {
    const styles = style('Strong', 'Strong', '<w:rPr><w:b/></w:rPr>', 'character');
    const word = read(
      p(
        [
          r('Ask ', '<w:b/>'),
          r('kindly', '<w:i/><w:u w:val="single"/>'),
          r(' and ', '<w:b w:val="0"/>'),
          r('never', '<w:rStyle w:val="Strong"/><w:strike/>'),
          r('hidden', '<w:vanish/>'),
          r(' rush', '<w:rStyle w:val="Strong"/><w:b w:val="false"/>'),
          '<w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t><w:br w:type="page"/></w:r>',
        ].join(''),
      ),
      { styles },
    );
    expect(word.html).toBe(
      '<p><b>Ask </b><u><i>kindly</i></u> and <s><b>never</b></s> rush' + 'a\tb<br>c</p>',
    );
  });

  it('takes tracked changes as accepted, and leaves out comments', () => {
    const word = read(
      p(
        [
          r('Call '),
          '<w:ins w:id="1" w:author="Avery"><w:r><w:t xml:space="preserve">back </w:t></w:r></w:ins>',
          '<w:del w:id="2" w:author="Avery"><w:r><w:delText>never </w:delText></w:r></w:del>',
          '<w:moveFrom w:id="3" w:author="Avery"><w:r><w:t>soon</w:t></w:r></w:moveFrom>',
          '<w:commentRangeStart w:id="0"/>',
          r('today'),
          '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r>',
        ].join(''),
      ),
    );
    expect(word.html).toBe('<p>Call back today</p>');
    expect(word.problems).toEqual([
      { file: 'Intake.docx', what: '1 comment left out', why: "Word comments aren't brought in." },
    ]);
  });

  it('makes lists from the numbering, nested, and numbered on after a paragraph', () => {
    const level = (n: number, format: string, start = 1) =>
      `<w:lvl w:ilvl="${n}"><w:start w:val="${start}"/><w:numFmt w:val="${format}"/></w:lvl>`;
    const numbering = [
      `<w:abstractNum w:abstractNumId="0">${level(0, 'bullet')}${level(1, 'lowerLetter')}</w:abstractNum>`,
      `<w:abstractNum w:abstractNumId="1">${level(0, 'decimal')}</w:abstractNum>`,
      '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>',
      '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>',
      '<w:num w:numId="3"><w:abstractNumId w:val="1"/>' +
        '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>',
    ].join('');
    const styles = style(
      'Steps',
      'Steps',
      '<w:pPr><w:numPr><w:numId w:val="2"/></w:numPr></w:pPr>',
    );
    const word = read(
      [
        item('Name', 1),
        item('First', 1, 1),
        item('Last', 1, 1),
        item('Date of birth', 1),
        item('Call', 2),
        p(r('Note'), styled('Steps')),
        p(r('Then:')),
        item('Book', 2),
        item('Restart', 3),
        p(r('Done'), '<w:numPr><w:numId w:val="0"/></w:numPr>'),
      ].join(''),
      { numbering, styles },
    );
    expect(word.html).toBe(
      '<ul><li><p>Name</p><ol type="a"><li><p>First</p></li><li><p>Last</p></li></ol></li>' +
        '<li><p>Date of birth</p></li></ul><ol><li><p>Call</p></li><li><p>Note</p></li></ol>' +
        '<p>Then:</p><ol start="3"><li><p>Book</p></li></ol><ol start="5"><li><p>Restart</p></li></ol>' +
        '<p>Done</p>',
    );
  });

  it('reads tables, links, pictures and footnotes', () => {
    const cell = (text: string) => `<w:tc>${p(r(text))}</w:tc>`;
    const picture =
      '<w:r><w:drawing><wp:inline><wp:docPr id="1" name="Picture 1" descr="The front desk"/>' +
      '<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    const footnotes =
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      `<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${r(' See the policy.')}</w:p></w:footnote>`;
    const word = read(
      [
        `<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr>${cell('Day')}${cell('Who')}</w:tr>`,
        `<w:tr>${cell('Mon')}${cell('Avery')}</w:tr></w:tbl>`,
        p(
          `<w:hyperlink r:id="rId5">${r('The intake form', '<w:u w:val="single"/>')}</w:hyperlink>` +
            '<w:hyperlink w:anchor="top">' +
            r(' (top)') +
            '</w:hyperlink><w:r><w:footnoteReference w:id="1"/></w:r>',
        ),
        p(picture),
      ].join(''),
      { footnotes },
      { rId4: 'word/media/image1.png', rId5: 'https://example.test/intake' },
    );
    expect(word.html).toBe(
      '<table><tr><th><p>Day</p></th><th><p>Who</p></th></tr>' +
        '<tr><td><p>Mon</p></td><td><p>Avery</p></td></tr></table>' +
        '<p><a href="https://example.test/intake">The intake form</a> (top)[1]</p>' +
        '<p><img src="word/media/image1.png" alt="The front desk"></p>' +
        '<h2>Notes</h2><ol><li><p> See the policy.</p></li></ol>',
    );
  });

  it('puts text boxes after their paragraph, and equations as their text', () => {
    const box =
      '<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor>' +
      '<wp:docPr id="2" name="Text Box 1"/><a:graphic><a:graphicData><wps:wsp><wps:txbx>' +
      `<w:txbxContent>${p(r('Boxed'))}</w:txbxContent>` +
      '</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice>' +
      `<mc:Fallback>${r('Fallback')}</mc:Fallback></mc:AlternateContent></w:r>`;
    const word = read(p(r('Before') + box) + p('<m:oMath><m:r><m:t>x = 2</m:t></m:r></m:oMath>'));
    expect(word.html).toBe('<p>Before</p><p>Boxed</p><p>x = 2</p>');
    expect(word.problems).toEqual([
      {
        file: 'Intake.docx',
        what: '1 equation kept as text',
        why: "Pages can't show them yet.",
      },
    ]);
  });
});
