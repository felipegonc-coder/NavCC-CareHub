import { describe, expect, it } from 'vitest';
import {
  attachmentKind,
  attachmentSchema,
  checkKeptAttachments,
  checkNewFiles,
  cleanFileName,
  fileProblem,
  formatFileSize,
  normalizeDescription,
  pictureGrid,
  splitAttachments,
  storedFile,
} from './attachments';
import type { UploadRules } from './attachments';

const MB = 1024 * 1024;
/** Pictures and PDFs up to 10 MB, nothing else (stands in for the workspace's upload rules). */
const rules: UploadRules = {
  maxBytesFor: (type) => (type.startsWith('image/') || type === 'application/pdf' ? 10 * MB : null),
};
const picture = (name: string, size = MB) => ({ name, type: 'image/jpeg', size });

describe('kinds of files', () => {
  it('knows pictures, video, audio, PDFs and other files by type', () => {
    const kinds: [string, string][] = [
      ['image/jpeg', 'picture'],
      ['IMAGE/PNG; charset=binary', 'picture'],
      ['image/gif', 'picture'],
      ['image/webp', 'picture'],
      ['image/heic', 'picture'],
      ['image/svg+xml', 'file'],
      ['video/mp4', 'video'],
      ['video/webm', 'video'],
      ['audio/mpeg', 'audio'],
      ['audio/x-m4a', 'audio'],
      ['audio/wav', 'audio'],
      ['audio/ogg', 'audio'],
      ['application/pdf', 'pdf'],
      ['application/zip', 'file'],
      ['', 'file'],
    ];
    for (const [type, kind] of kinds) expect(attachmentKind(type)).toBe(kind);
  });

  it('turns HEIC pictures into JPEG', () => {
    expect(storedFile({ name: 'IMG_0001.HEIC', type: 'image/heic' })).toEqual({
      name: 'IMG_0001.jpg',
      type: 'image/jpeg',
      convertToJpeg: true,
    });
    expect(storedFile({ name: 'Schedule.pdf', type: 'application/pdf' })).toEqual({
      name: 'Schedule.pdf',
      type: 'application/pdf',
      convertToJpeg: false,
    });
  });
});

describe('MS-15 showing files', () => {
  it('shows 3 pictures and a PDF as a grid and a file card', () => {
    const files = [
      { id: 'a', kind: 'picture' as const },
      { id: 'b', kind: 'pdf' as const },
      { id: 'c', kind: 'picture' as const },
      { id: 'd', kind: 'video' as const },
      { id: 'e', kind: 'picture' as const },
    ];
    const { pictures, media, files: cards } = splitAttachments(files);
    expect(pictures.map((file) => file.id)).toEqual(['a', 'c', 'e']);
    expect(media.map((file) => file.id)).toEqual(['d']);
    expect(cards.map((file) => file.id)).toEqual(['b']);
    expect(pictureGrid(pictures)).toEqual({
      layout: 'grid',
      shown: pictures,
      more: 0,
      moreLabel: null,
    });
  });

  it('shows one picture large and more than 4 as "+3"', () => {
    expect(pictureGrid([])).toMatchObject({ layout: 'none', shown: [] });
    expect(pictureGrid(['a'])).toMatchObject({ layout: 'single', shown: ['a'], more: 0 });
    const seven = pictureGrid(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(seven).toEqual({
      layout: 'grid',
      shown: ['a', 'b', 'c', 'd'],
      more: 3,
      moreLabel: '+3',
    });
  });

  it('shows sizes in KB, MB and GB', () => {
    const sizes: [number, string][] = [
      [0, '0 bytes'],
      [1, '1 byte'],
      [820, '820 bytes'],
      [1024, '1 KB'],
      [1536, '1.5 KB'],
      [2.44 * MB, '2.4 MB'],
      [15 * MB, '15 MB'],
      [1023.9 * 1024, '1 MB'],
      [3 * 1024 * MB, '3 GB'],
    ];
    for (const [bytes, text] of sizes) expect(formatFileSize(bytes)).toBe(text);
  });
});

describe('adding files', () => {
  it('takes up to 10 files per message', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => picture(`Photo ${i + 1}.jpg`));
    const { accepted, rejected } = checkNewFiles(twelve, rules);
    expect(accepted).toHaveLength(10);
    expect(rejected.map((r) => [r.file.name, r.problem])).toEqual([
      ['Photo 11.jpg', 'too-many-files'],
      ['Photo 12.jpg', 'too-many-files'],
    ]);
    expect(checkNewFiles(twelve, rules, 9).accepted).toHaveLength(1);
  });

  it('follows the workspace upload types and sizes', () => {
    const big = picture('Big.jpg', 11 * MB);
    const zip = { name: 'Notes.zip', type: 'application/zip', size: MB };
    expect(fileProblem(big, rules)).toBe('too-large');
    expect(fileProblem(zip, rules)).toBe('type-not-allowed');
    expect(fileProblem(picture('Fine.jpg'), rules)).toBeNull();
    const { accepted, rejected } = checkNewFiles([big, zip, picture('Fine.jpg')], rules, 9);
    expect(accepted.map((file) => file.name)).toEqual(['Fine.jpg']);
    expect(rejected.map((r) => r.problem)).toEqual(['too-large', 'type-not-allowed']);
  });

  it('lets an edit remove files but not add them', () => {
    expect(checkKeptAttachments(['a', 'b', 'c'], ['c', 'a', 'a'])).toEqual({
      ok: true,
      keepIds: ['a', 'c'],
      removeIds: ['b'],
    });
    expect(checkKeptAttachments(['a', 'b'], ['a', 'z'])).toEqual({
      ok: false,
      error: 'cannot-add-files',
    });
  });
});

describe('file names and descriptions', () => {
  it('cleans file names', () => {
    expect(cleanFileName('C:\\Users\\avery\\Schedule.pdf')).toBe('Schedule.pdf');
    expect(cleanFileName('../../QA\nform.pdf')).toBe('QA form.pdf');
    expect(cleanFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(cleanFileName('   ')).toBe('file');
    const long = cleanFileName(`${'a'.repeat(300)}.pdf`);
    expect(long).toBe(`${'a'.repeat(251)}.pdf`);
  });

  it('keeps picture descriptions to one line of up to 1,000 characters', () => {
    expect(normalizeDescription('  Avery and Sam\nat the stand-up ')).toEqual({
      ok: true,
      description: 'Avery and Sam at the stand-up',
    });
    expect(normalizeDescription('   ')).toEqual({ ok: true, description: null });
    expect(normalizeDescription('x'.repeat(1001))).toEqual({ ok: false, error: 'too-long' });
  });

  it('describes a file for viewers', () => {
    const file = {
      id: 'file-1',
      kind: 'picture',
      name: 'Stand-up.jpg',
      type: 'image/jpeg',
      size: 2048,
      width: 1200,
      height: 800,
      description: null,
    };
    expect(attachmentSchema.parse(file)).toEqual(file);
    expect(attachmentSchema.safeParse({ ...file, kind: 'sticker' }).success).toBe(false);
  });
});
