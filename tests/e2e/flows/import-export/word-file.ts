import { png, zip, type FilePayload } from './zip-files.js';

// IE-02: a Word file (.docx: WordprocessingML parts in a zip) written from scratch. It has two
// heading styles, a bulleted list, a link, a footnote, a table, a picture and one tracked change
// that replaces "home address" with "callback number".

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE = 'http://schemas.openxmlformats.org/package/2006';

const xml = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`;
const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const paragraph = (inside: string, style = '') =>
  `<w:p>${style ? `<w:pPr>${style}</w:pPr>` : ''}${inside}</w:p>`;
const heading = (level: 1 | 2, text: string) =>
  paragraph(run(text), `<w:pStyle w:val="Heading${level}"/>`);
const bullet = (text: string) =>
  paragraph(run(text), '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
const cell = (text: string) => `<w:tc>${paragraph(run(text))}</w:tc>`;
const tracked = `w:author="Fictional Reviewer" w:date="2026-10-20T15:00:00Z"`;

/** The picture's size in EMU (English Metric Units): 1 inch by 2/3 of an inch. */
const EXTENT = 'cx="914400" cy="609600"';

const picture = `<w:r><w:drawing><wp:inline><wp:extent ${EXTENT}/><wp:docPr id="1" name="Picture 1" descr="Intake desk"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="desk.png" descr="Intake desk"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdPicture"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext ${EXTENT}/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const document = [
  heading(1, 'Before the call'),
  paragraph(
    `${run('Check the ')}<w:hyperlink r:id="rIdHelp"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>Care Hub help</w:t></w:r></w:hyperlink>${run(' page first.')}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="1"/></w:r>`,
  ),
  bullet('Name and pronouns'),
  bullet('Best time to call back'),
  heading(2, 'Questions to ask'),
  paragraph(
    `${run('Confirm the ')}<w:del w:id="10" ${tracked}><w:r><w:delText>home address</w:delText></w:r></w:del><w:ins w:id="11" ${tracked}>${run('callback number')}</w:ins>${run(' before you hang up.')}`,
  ),
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr>${cell('Question')}${cell('Why we ask')}</w:tr><w:tr>${cell('Is now a good time?')}${cell('So the call fits their day')}</w:tr></w:tbl>`,
  paragraph(picture),
].join('');

const relationship = (id: string, type: string, target: string, external = false) =>
  `<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"${external ? ' TargetMode="External"' : ''}/>`;

const override = (part: string, type: string) =>
  `<Override PartName="/word/${part}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;

const style = (type: string, id: string, name: string, inside: string) =>
  `<w:style w:type="${type}" w:styleId="${id}"><w:name w:val="${name}"/>${inside}</w:style>`;

/** "Intake script.docx", with what each part of it should become on the page. */
export function wordFile(): FilePayload & { footnote: string; link: string; kept: string } {
  return {
    name: 'Intake script.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    footnote: 'Callers can ask for a callback window.',
    link: 'https://help.example.test/intake',
    kept: 'Confirm the callback number before you hang up.',
    buffer: zip([
      {
        path: '[Content_Types].xml',
        data: xml(
          `<Types xmlns="${PACKAGE}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>${override('document', 'document.main')}${override('styles', 'styles')}${override('numbering', 'numbering')}${override('footnotes', 'footnotes')}</Types>`,
        ),
      },
      {
        path: '_rels/.rels',
        data: xml(
          `<Relationships xmlns="${PACKAGE}/relationships">${relationship('rIdDocument', 'officeDocument', 'word/document.xml')}</Relationships>`,
        ),
      },
      {
        path: 'word/_rels/document.xml.rels',
        data: xml(
          `<Relationships xmlns="${PACKAGE}/relationships">${relationship('rIdStyles', 'styles', 'styles.xml')}${relationship('rIdNumbering', 'numbering', 'numbering.xml')}${relationship('rIdFootnotes', 'footnotes', 'footnotes.xml')}${relationship('rIdPicture', 'image', 'media/desk.png')}${relationship('rIdHelp', 'hyperlink', 'https://help.example.test/intake', true)}</Relationships>`,
        ),
      },
      {
        path: 'word/document.xml',
        data: xml(
          `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${document}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`,
        ),
      },
      {
        path: 'word/styles.xml',
        data: xml(
          `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('paragraph', 'Heading1', 'heading 1', '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr>')}${style('paragraph', 'Heading2', 'heading 2', '<w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr>')}${style('character', 'Hyperlink', 'Hyperlink', '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>')}${style('character', 'FootnoteReference', 'footnote reference', '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>')}</w:styles>`,
        ),
      },
      {
        path: 'word/numbering.xml',
        data: xml(
          `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
        ),
      },
      {
        path: 'word/footnotes.xml',
        data: xml(
          `<w:footnotes xmlns:w="${W}"><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote><w:footnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(' Callers can ask for a callback window.')}</w:p></w:footnote></w:footnotes>`,
        ),
      },
      { path: 'word/media/desk.png', data: png(96, 64, [194, 24, 91]) },
    ]),
  };
}
