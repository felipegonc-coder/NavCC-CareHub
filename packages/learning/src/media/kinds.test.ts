import { describe, expect, it } from 'vitest';
import {
  CHECK_END_BYTES,
  CHECK_HEAD_BYTES,
  MAX_UPLOAD_BYTES,
  MEDIA_KINDS,
  MEDIA_SIZE_LIMITS,
  acceptAttribute,
  checkUpload,
  formatBytes,
  needsEnd,
  safeFileName,
  sizeLimit,
  sniffFile,
  type UploadCheck,
} from './kinds';

type Part = string | number | readonly number[];
const bytes = (...parts: Part[]): Uint8Array =>
  Uint8Array.from(
    parts.flatMap((part) =>
      typeof part === 'string'
        ? Array.from(part, (c) => c.charCodeAt(0))
        : typeof part === 'number'
          ? [part]
          : [...part],
    ),
  );
/** UTF-8 bytes of a text (encodeURIComponent writes UTF-8 as %XX). */
const utf8 = (text: string) =>
  Uint8Array.from(encodeURIComponent(text).match(/%[0-9A-F]{2}|[^%]/g) ?? [], (part) =>
    part.length === 3 ? parseInt(part.slice(1), 16) : part.charCodeAt(0),
  );
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const wide = (text: string) => Array.from(text).flatMap((c) => [c.charCodeAt(0), 0]);
/** Pads a file's start with zeros up to `size` bytes. */
const padded = (start: Uint8Array, size: number) => {
  const out = new Uint8Array(size);
  out.set(start);
  return out;
};
const MB = 1024 * 1024;

const png = (width: number, height: number) =>
  bytes('\x89PNG\r\n\x1a\n', be32(13), 'IHDR', be32(width), be32(height), [8, 6, 0, 0, 0], be32(0));
const ftyp = (brand: string) => bytes(be32(24), 'ftyp', brand, be32(0), 'isomiso2');
const zipEntry = (name: string, content = '') =>
  bytes('PK\x03\x04', new Array<number>(22).fill(0), [name.length, 0, 0, 0], name, content);
const cfb = (...streams: string[]) =>
  bytes(
    '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1',
    new Array<number>(504).fill(0),
    ...streams.map((s) => wide(s)),
  );
const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nHello\n';

/** The type sniffFile finds, or its reason for refusing. */
const sniff = (file: Uint8Array, name?: string) => {
  const result = sniffFile(file, name);
  return result.ok
    ? `${result.type.mime} ${result.type.extension} ${result.type.kinds.join('/')}`
    : result.reason;
};
const refusal = (check: UploadCheck) =>
  check.ok ? 'accepted' : `${check.problem}: ${check.reason}`;

describe('sniffFile', () => {
  it('finds pictures from their content', () => {
    expect(sniff(png(1, 1))).toBe('image/png png image');
    expect(sniff(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg jpg image');
    expect(sniff(bytes('GIF89a'))).toBe('image/gif gif image');
    expect(sniff(bytes('RIFF', be32(0), 'WEBPVP8 '))).toBe('image/webp webp image');
  });

  it('never trusts the file name', () => {
    expect(sniff(png(1, 1), 'notes.pdf')).toBe('image/png png image');
    expect(sniff(bytes('MZ', [0x90, 0]), 'photo.jpg')).toBe(
      "Programs and scripts can't be uploaded.",
    );
  });

  it('finds audio and video, and says which can serve both', () => {
    expect(sniff(ftyp('isom'))).toBe('video/mp4 mp4 video/audio');
    expect(sniff(ftyp('mp42'))).toBe('video/mp4 mp4 video/audio');
    expect(sniff(ftyp('qt  '))).toBe('video/mp4 mov video/audio');
    expect(sniff(ftyp('M4A '))).toBe('audio/mp4 m4a audio');
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84], 'webm'))).toBe(
      'video/webm webm video/audio',
    );
    expect(sniff(bytes('RIFF', be32(0), 'WAVEfmt '))).toBe('audio/wav wav audio');
    expect(sniff(bytes('OggS', new Array<number>(24).fill(0), 'OpusHead'))).toBe(
      'audio/ogg ogg audio',
    );
    expect(sniff(bytes('OggS', new Array<number>(24).fill(0), [1], 'vorbis'))).toBe(
      'audio/ogg ogg audio',
    );
    expect(sniff(bytes('fLaC'))).toBe('audio/flac flac audio');
    expect(sniff(bytes('ID3', [4, 0, 0]))).toBe('audio/mpeg mp3 audio');
    expect(sniff(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe('audio/mpeg mp3 audio');
    expect(sniff(bytes([0xff, 0xf1, 0x50, 0x80]))).toBe('audio/aac aac audio');
  });

  it("refuses media that browsers can't show, with what to do instead", () => {
    expect(sniff(ftyp('heic'))).toMatch(/^HEIC and AVIF pictures .* Save it as JPEG or PNG/);
    expect(sniff(ftyp('avif'))).toMatch(/^HEIC and AVIF/);
    expect(sniff(bytes('RIFF', be32(0), 'AVI LIST'))).toMatch(/^AVI videos .* Save it as MP4/);
    expect(sniff(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88], 'matroska'))).toMatch(
      /^MKV videos/,
    );
    expect(sniff(bytes('OggS', new Array<number>(24).fill(0), [0x80], 'theora'))).toMatch(
      /^This OGG file isn't audio/,
    );
    expect(sniff(ftyp('crx '))).toMatch(/^Care Hub can't tell what kind of file this is/);
  });

  it('finds documents', () => {
    expect(sniff(bytes('%PDF-1.7\n'))).toBe('application/pdf pdf document');
    expect(sniff(zipEntry('[Content_Types].xml', 'word/document.xml'))).toMatch(
      /wordprocessingml\.document docx document$/,
    );
    expect(sniff(zipEntry('[Content_Types].xml', 'xl/workbook.xml'))).toMatch(
      /spreadsheetml\.sheet xlsx document$/,
    );
    expect(sniff(zipEntry('ppt/presentation.xml'))).toMatch(
      /presentationml\.presentation pptx document$/,
    );
    for (const app of ['text', 'spreadsheet', 'presentation']) {
      const odf = zipEntry('mimetype', `application/vnd.oasis.opendocument.${app}`);
      expect(sniff(odf)).toMatch(
        new RegExp(`^application/vnd\\.oasis\\.opendocument\\.${app} od[tsp] document$`),
      );
    }
    expect(sniff(cfb('Root Entry', 'WordDocument'))).toBe('application/msword doc document');
    expect(sniff(cfb('Root Entry', 'Workbook'))).toBe('application/vnd.ms-excel xls document');
    expect(sniff(cfb('Root Entry', 'PowerPoint Document'))).toBe(
      'application/vnd.ms-powerpoint ppt document',
    );
    expect(sniff(bytes('{\\rtf1\\ansi Hello}'))).toBe('application/rtf rtf document');
  });

  it('refuses macros, zip files, unknown containers and programs', () => {
    expect(sniff(zipEntry('word/document.xml', 'word/vbaProject.bin'))).toMatch(
      /^Documents with macros can't be uploaded/,
    );
    expect(sniff(cfb('WordDocument', '_VBA_PROJECT'))).toMatch(/^Documents with macros/);
    expect(sniff(zipEntry('photos/one.jpg'))).toMatch(/^Zip files can't be uploaded/);
    expect(sniff(cfb('Root Entry'))).toMatch(/^Care Hub can't tell/);
    expect(sniff(bytes('\x7fELF'))).toBe("Programs and scripts can't be uploaded.");
    expect(sniff(bytes([0xcf, 0xfa, 0xed, 0xfe]))).toBe("Programs and scripts can't be uploaded.");
    expect(sniff(utf8('#!/bin/sh\necho hi\n'))).toBe("Programs and scripts can't be uploaded.");
  });

  it('finds captions and text documents, using the name only to tell text formats apart', () => {
    expect(sniff(utf8(vtt))).toBe('text/vtt vtt captions');
    expect(sniff(utf8(`\uFEFF${vtt}`))).toBe('text/vtt vtt captions');
    expect(sniff(utf8('WEBVTT - Ward tour\n'))).toBe('text/vtt vtt captions');
    expect(sniff(utf8('WEBVTTX\n'), 'a.vtt')).toBe('text/plain txt document');
    expect(sniff(utf8('name,role\nAda,Nurse\n'), 'Rota.CSV')).toBe('text/csv csv document');
    expect(sniff(utf8('# Handover\n'), 'notes.md')).toBe('text/markdown md document');
    expect(sniff(utf8('Plain notes, café ✓\n'), 'notes.txt')).toBe('text/plain txt document');
  });

  it("refuses text it can't serve safely, with a plain reason", () => {
    expect(sniff(utf8('1\n00:00:01,000 --> 00:00:02,000\nHello\n'))).toMatch(
      /^This is an SRT subtitle file\. .*WebVTT/,
    );
    expect(
      sniff(utf8('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).toMatch(/^SVG pictures/);
    expect(sniff(utf8('<!doctype html><html></html>'))).toMatch(
      /^Web pages and XML files can't be uploaded/,
    );
    expect(sniff(bytes('caf\xe9 au lait'))).toMatch(/^Text files need to be saved as UTF-8/);
    expect(sniff(bytes([0, 1, 2, 3, 0xfe, 0xff]))).toMatch(/^Care Hub can't tell/);
    expect(sniff(utf8('text with a \u0001 control character'))).toMatch(/^Care Hub can't tell/);
    expect(sniff(new Uint8Array())).toBe('The file is empty.');
  });
});

describe('checkUpload', () => {
  it('accepts a picture with its size and a clean name', () => {
    expect(
      checkUpload(png(800, 600), { name: 'C:\\fakepath\\Ward map.PNG', accept: ['image'] }),
    ).toEqual({
      ok: true,
      kind: 'image',
      mime: 'image/png',
      extension: 'png',
      label: 'PNG picture',
      name: 'Ward map.png',
      bytes: 33,
      width: 800,
      height: 600,
    });
  });

  it('serves an MP4 as video, or as audio where only audio is accepted', () => {
    expect(checkUpload(ftyp('isom'), { name: 'tour.mp4' })).toMatchObject({
      ok: true,
      kind: 'video',
      mime: 'video/mp4',
    });
    expect(checkUpload(ftyp('isom'), { name: 'talk.mp4', accept: ['audio'] })).toMatchObject({
      ok: true,
      kind: 'audio',
      mime: 'audio/mp4',
      name: 'talk.mp4',
    });
    expect(checkUpload(utf8(vtt), { name: 'captions.vtt', accept: ['captions'] })).toMatchObject({
      ok: true,
      kind: 'captions',
    });
    expect(checkUpload(bytes('%PDF-1.4'))).toMatchObject({
      ok: true,
      kind: 'document',
      name: 'file.pdf',
    });
  });

  it('refuses empty, unknown and wrong-kind files', () => {
    expect(refusal(checkUpload(new Uint8Array()))).toBe('empty: The file is empty.');
    expect(refusal(checkUpload(bytes('MZ')))).toBe(
      "unsupported: Programs and scripts can't be uploaded.",
    );
    expect(refusal(checkUpload(bytes('%PDF-1.4'), { accept: ['image'] }))).toBe(
      "wrong_kind: This PDF document can't be used here. Choose a picture (PNG, JPEG, GIF or WebP).",
    );
    expect(refusal(checkUpload(png(10, 10), { accept: ['video', 'audio'] }))).toBe(
      "wrong_kind: This PNG picture can't be used here. Choose a video (MP4, MOV or WebM) or an audio file (MP3, M4A, AAC, WAV, OGG, FLAC or WebM).",
    );
    expect(checkUpload(png(10, 10), { accept: [] })).toMatchObject({ ok: true, kind: 'image' }); // empty = any kind
  });

  it("applies the size limit of the kind, below core's 100 MB files limit", () => {
    expect(MEDIA_SIZE_LIMITS).toEqual({
      image: 10 * MB,
      video: 50 * MB,
      audio: 25 * MB,
      captions: MB,
      document: 25 * MB,
    });
    expect(MAX_UPLOAD_BYTES).toBe(50 * MB);
    expect(sizeLimit(['video', 'audio'])).toBe(50 * MB);
    expect(sizeLimit(['captions'])).toBe(MB);
    expect(refusal(checkUpload(padded(png(10, 10), 11 * MB)))).toBe(
      'too_large: This picture is 11 MB. Pictures can be at most 10 MB.',
    );
    expect(refusal(checkUpload(padded(png(10, 10), 11 * MB), { accept: ['image'] }))).toBe(
      'too_large: This file is 11 MB. Uploads here can be at most 10 MB.',
    );
    const longCaptions = new Uint8Array(2 * MB).fill(0x0a); // blank lines after one caption
    longCaptions.set(utf8(vtt));
    expect(refusal(checkUpload(longCaptions))).toBe(
      'too_large: This captions file is 2 MB. Captions files can be at most 1 MB.',
    );
    expect(refusal(checkUpload(ftyp('isom'), { size: 50 * MB + 1 }))).toBe(
      'too_large: This file is 50 MB. Uploads here can be at most 50 MB.',
    );
    expect(checkUpload(padded(ftyp('isom'), 50 * MB))).toMatchObject({ ok: true, kind: 'video' });
    expect(refusal(checkUpload(ftyp('isom'), { size: 30 * MB, accept: ['audio'] }))).toBe(
      'too_large: This file is 30 MB. Uploads here can be at most 25 MB.',
    );
  });

  it('checks a big file from its first bytes and its full size', () => {
    expect(refusal(checkUpload(ftyp('isom'), { size: 300 * MB, name: 'tour.mp4' }))).toBe(
      'too_large: This file is 300 MB. Uploads here can be at most 50 MB.',
    );
    expect(checkUpload(ftyp('isom'), { size: 20 * MB, accept: ['video'] })).toMatchObject({
      ok: true,
      kind: 'video',
      bytes: 20 * MB,
    });
    expect(refusal(checkUpload(new Uint8Array(), { size: 10 }))).toBe('empty: The file is empty.');
  });

  it("reads what's inside a big zip or old Office file from its end", () => {
    expect([CHECK_HEAD_BYTES, CHECK_END_BYTES]).toEqual([MB, 64 * 1024]);
    const head = zipEntry('[Content_Types].xml'); // the list of contents is at the end
    const docx = zipEntry('word/document.xml');
    const docm = Uint8Array.from([
      ...zipEntry('word/document.xml'),
      ...zipEntry('word/vbaProject.bin'),
    ]);
    const size = 20 * MB;
    expect(needsEnd(head)).toBe(true);
    expect(needsEnd(cfb())).toBe(true);
    expect(needsEnd(png(1, 1))).toBe(false);
    expect(checkUpload(head, { size, end: docx })).toMatchObject({ ok: true, extension: 'docx' });
    expect(refusal(checkUpload(head, { size }))).toMatch(/^unsupported: Zip files can't/);
    expect(refusal(checkUpload(head, { size, end: docm }))).toMatch(
      /^unsupported: Documents with macros can't be uploaded/,
    );
    expect(checkUpload(cfb(), { size, end: bytes(wide('WordDocument')) })).toMatchObject({
      ok: true,
      extension: 'doc',
    });
  });

  it('accepts the start of a text file that ends partway through a character', () => {
    const start = utf8('Shift notes: café');
    const cut = start.subarray(0, start.length - 1); // "é" is two bytes
    expect(checkUpload(cut, { size: 2 * MB, name: 'notes.txt' })).toMatchObject({
      ok: true,
      mime: 'text/plain',
    });
    expect(refusal(checkUpload(cut, { name: 'notes.txt' }))).toBe(
      'unsupported: Text files need to be saved as UTF-8. Save it as UTF-8 and upload it again.',
    );
  });

  it('refuses damaged and oversized pictures', () => {
    expect(refusal(checkUpload(bytes('\x89PNG\r\n\x1a\n', be32(0), 'IEND')))).toBe(
      "damaged: This picture seems to be damaged: Care Hub can't read its size.",
    );
    expect(refusal(checkUpload(png(13_000, 100)))).toBe(
      'too_many_pixels: This picture is 13,000 × 100 pixels. Pictures can be at most 12,000 pixels on a side and 50 megapixels in total.',
    );
    expect(refusal(checkUpload(png(8000, 7000)))).toMatch(
      /^too_many_pixels: This picture is 8,000 × 7,000 pixels/,
    );
    expect(checkUpload(png(12_000, 4000))).toMatchObject({ ok: true, width: 12_000, height: 4000 });
  });

  it('refuses captions that need fixing, listing the first three problems', () => {
    const backwards = 'WEBVTT\n\n00:05.000 --> 00:04.000\nOne\n';
    expect(refusal(checkUpload(utf8(backwards), { accept: ['captions'] }))).toBe(
      'bad_captions: This captions file needs fixing. Line 3: This caption ends before it starts.',
    );
    const broken = [
      'WEBVTT',
      '',
      ...['a', 'b', 'c', 'd', 'e'].flatMap((word) => [`${word} --> soon`, word, '']),
    ].join('\n');
    expect(refusal(checkUpload(utf8(broken)))).toMatch(
      /^bad_captions: This captions file needs fixing\. Line 3: .* Line 6: .* Line 9: .* And 2 more\.$/,
    );
  });
});

describe('helpers', () => {
  it('formats sizes for people', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(1023)).toBe('1023 bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2.45 * MB)).toBe('2.5 MB');
    expect(formatBytes(MB - 1)).toBe('1 MB');
    expect(formatBytes(50 * MB)).toBe('50 MB');
    expect(formatBytes(3 * 1024 * MB)).toBe('3 GB');
  });

  it('cleans file names and gives them the extension of their content', () => {
    expect(safeFileName('../../etc/passwd', 'txt')).toBe('passwd.txt');
    expect(safeFileName('report.final.docx', 'pdf')).toBe('report.final.pdf');
    expect(safeFileName('a<b>:c"d|e?f*g.txt', 'txt')).toBe('abcdefg.txt');
    expect(safeFileName('  Ward \t  map .png ', 'png')).toBe('Ward map.png');
    expect(safeFileName('CON.txt', 'txt')).toBe('_CON.txt');
    expect(safeFileName('...', 'pdf')).toBe('file.pdf');
    expect(safeFileName(undefined, 'vtt')).toBe('file.vtt');
    expect(safeFileName('Cafe\u0301 notes.md', 'md')).toBe('Café notes.md');
    const long = safeFileName(`${'Handover '.repeat(40)}.pdf`, 'pdf');
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long).toMatch(/^(Handover )+Handove\.pdf$/);
    const emoji = safeFileName(`${'😀'.repeat(300)}.png`, 'png');
    expect(emoji.length).toBe(200);
    expect(emoji).toMatch(/^(😀)+\.png$/u);
  });

  it('builds file input accept lists', () => {
    expect(acceptAttribute(['captions'])).toBe('text/vtt,.vtt');
    expect(acceptAttribute(['image', 'captions'])).toBe(
      'image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp,text/vtt,.vtt',
    );
    expect(MEDIA_KINDS).toEqual(['image', 'video', 'audio', 'captions', 'document']);
  });
});
