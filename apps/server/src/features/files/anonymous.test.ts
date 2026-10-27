import { describe, expect, it } from 'vitest';
import { anonymousRefusal } from './anonymous';
import { detectFileType, type ReadAt } from './detect';
import { office, zip } from './testing';

/** Why a made-up file can't be added to an anonymous scope, or null. */
async function refusal(data: Buffer | string, name: string) {
  const file = typeof data === 'string' ? Buffer.from(data) : data;
  const read: ReadAt = async (offset, length) => file.subarray(offset, offset + length);
  const type = await detectFileType({
    head: file.subarray(0, 4096),
    size: file.length,
    name,
    read,
  });
  if (type === 'program') throw new Error(`${name} is a program`);
  return anonymousRefusal({ type, name, size: file.length, read });
}

const NOT_TAKEN = /^Only JPEG and PNG pictures, PDFs, Word, Excel and PowerPoint files/;
const MACROS = /^Files with macros or ActiveX controls can't be added here\./;
const JPEG = Buffer.from('ffd8ffe000104a464946000101000001000100000000', 'hex');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

describe('anonymousRefusal', () => {
  it('takes JPEG and PNG pictures, PDFs, Office files and text', async () => {
    expect(await refusal(JPEG, 'photo.jpg')).toBeNull();
    expect(await refusal(PNG, 'scan.png')).toBeNull();
    expect(await refusal('%PDF-1.7 fictional', 'letter.pdf')).toBeNull();
    expect(await refusal(office('word'), 'Fictional letter.docx')).toBeNull();
    expect(await refusal(office('xl'), 'rota.xlsx')).toBeNull();
    expect(await refusal(office('ppt'), 'talk.pptx')).toBeNull();
    expect(await refusal('Fictional notes', 'notes.txt')).toBeNull();
    expect(await refusal('name,ward\nAvery Lin,Fictional', 'list.csv')).toBeNull();
  });

  it('keeps charts, whose workbooks are embedded', async () => {
    const chart = office('ppt', ['ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx']);
    expect(await refusal(chart, 'talk.pptx')).toBeNull();
  });

  it('refuses other types, old Office files among them', async () => {
    expect(await refusal('GIF89a fictional', 'wave.gif')).toMatch(NOT_TAKEN);
    expect(await refusal('<svg xmlns="http://www.w3.org/2000/svg"/>', 'logo.svg')).toMatch(
      NOT_TAKEN,
    );
    expect(await refusal('<html>Fictional</html>', 'page.html')).toMatch(NOT_TAKEN);
    expect(await refusal(zip([['notes.txt', 'Fictional']]), 'notes.zip')).toMatch(NOT_TAKEN);
    const oldWord = Buffer.alloc(512);
    Buffer.from('d0cf11e0a1b11ae1', 'hex').copy(oldWord);
    expect(await refusal(oldWord, 'letter.doc')).toMatch(NOT_TAKEN);
  });

  it('refuses macros, ActiveX controls and embedded programs', async () => {
    expect(await refusal(office('word', ['word/vbaProject.bin']), 'letter.docm')).toMatch(MACROS);
    expect(await refusal(office('word', ['word/vbaProject.bin']), 'letter.docx')).toMatch(MACROS);
    expect(await refusal(office('word', ['word/vbaData.xml']), 'letter.docx')).toMatch(MACROS);
    expect(await refusal(office('xl', ['xl/macrosheets/sheet1.xml']), 'rota.xlsx')).toMatch(MACROS);
    expect(await refusal(office('ppt', ['ppt/activeX/activeX1.xml']), 'talk.pptx')).toMatch(MACROS);
    const embedded = office('word', ['word/embeddings/oleObject1.bin']);
    expect(await refusal(embedded, 'letter.docx')).toMatch(MACROS);
    expect(await refusal(office('xl', ['XL/VBAPROJECT.BIN']), 'rota.xlsx')).toMatch(MACROS);
  });

  it('needs the ending that matches the contents', async () => {
    expect(await refusal(office('word'), 'letter.xlsx')).toBe(
      "This file's name doesn't match what's in it. Rename it to end in .docx and try again.",
    );
    expect(await refusal('%PDF-1.7 fictional', 'letter.html')).toMatch(/end in \.pdf /);
    expect(await refusal('print("fictional")', 'tool.py')).toMatch(/end in \.txt /);
    expect(await refusal('Fictional notes', 'notes')).toMatch(/end in \.txt /);
  });
});
