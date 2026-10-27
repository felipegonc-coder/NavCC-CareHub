import { describe, expect, it } from 'vitest';
import { checkFile, readBytes } from './read-file';
import { pngFile } from './testing';

const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
/** One zip entry header with its name (enough for the content check). */
const zipEntry = (name: string) =>
  Uint8Array.from([
    ...ascii('PK\x03\x04'),
    ...new Array<number>(22).fill(0),
    name.length,
    0,
    0,
    0,
    ...ascii(name),
  ]);

describe('checkFile', () => {
  it('reads the file and checks it for the kinds asked for', async () => {
    expect(await checkFile(pngFile('Ward map.PNG', 40, 30), ['image'])).toMatchObject({
      ok: true,
      kind: 'image',
      name: 'Ward map.png',
      width: 40,
      height: 30,
    });
    expect(await checkFile(new File(['%PDF-1.7'], 'notes.pdf'), ['image'])).toMatchObject({
      ok: false,
      problem: 'wrong_kind',
    });
  });

  it('reads the end of a big zip-based document, where its contents are listed', async () => {
    const size = 1536 * 1024;
    const bytes = new Uint8Array(size);
    bytes.set(zipEntry('[Content_Types].xml'));
    bytes.set(zipEntry('word/document.xml'), size - 1024);
    const check = await checkFile(new File([bytes], 'Handover.docx'), ['document']);
    expect(check).toMatchObject({ ok: true, extension: 'docx', bytes: size });
  });

  it('refuses an empty file', async () => {
    expect(await checkFile(new File([], 'empty.png'), ['image'])).toMatchObject({
      ok: false,
      problem: 'empty',
    });
  });
});

describe('readBytes', () => {
  it('reads part of a file', async () => {
    const file = new File([Uint8Array.from([1, 2, 3, 4])], 'four.bin');
    expect(Array.from(await readBytes(file.slice(1, 3)))).toEqual([2, 3]);
  });
});
