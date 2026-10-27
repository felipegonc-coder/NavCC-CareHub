import { describe, expect, it } from 'vitest';
import { detectFileType, hasBlockedEnding, showsInBrowser, type ReadAt } from './detect';

// Small made-up files: only the bytes each format is recognised by.
const hex = (value: string) => Buffer.from(value.replace(/\s/g, ''), 'hex');
const bytes = (...parts: Array<string | Buffer>) =>
  Buffer.concat(
    parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'latin1') : part)),
  );

function detect(data: Buffer | string, name = 'file') {
  const file = typeof data === 'string' ? Buffer.from(data) : data;
  const read: ReadAt = async (offset, length) => file.subarray(offset, offset + length);
  return detectFileType({ head: file.subarray(0, 4096), size: file.length, name, read });
}

/** A ZIP file with stored (uncompressed) entries. */
function zip(entries: Array<[name: string, content: string]>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, nameBytes, data);
    central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

/** An OLE compound file (old Office, Outlook and Windows Installer) whose root entry has `classId`. */
function ole(classId: string): Buffer {
  const file = Buffer.alloc(1024);
  hex('d0cf11e0a1b11ae1').copy(file, 0);
  file.writeUInt16LE(9, 30); // 512-byte sectors
  file.writeUInt32LE(0, 48); // the directory starts in sector 0, right after the header
  hex(classId).copy(file, 512 + 80);
  return file;
}

const ftyp = (major: string, ...compatible: string[]) => {
  const box = bytes('\0\0\0\0ftyp', major, '\0\0\0\0', ...compatible);
  box.writeUInt32BE(box.length, 0);
  return Buffer.concat([box, Buffer.alloc(16)]);
};

describe('detectFileType', () => {
  it('finds pictures, video, audio and PDFs from their contents', async () => {
    const cases: Array<[Buffer | string, string]> = [
      [hex('89504e470d0a1a0a0000000d49484452'), 'image/png'],
      [hex('ffd8ffe000104a464946'), 'image/jpeg'],
      ['GIF89a\x01\x00\x01\x00', 'image/gif'],
      [bytes('RIFF\x24\0\0\0WEBPVP8 '), 'image/webp'],
      [ftyp('avif', 'mif1', 'avif'), 'image/avif'],
      [ftyp('heic', 'mif1', 'heic'), 'image/heic'],
      [ftyp('isom', 'isom', 'mp42'), 'video/mp4'],
      [ftyp('qt  ', 'qt  '), 'video/quicktime'],
      [ftyp('M4A ', 'M4A ', 'mp42'), 'audio/mp4'],
      [bytes(hex('1a45dfa3'), '\x9f\x42\x82\x84webm'), 'video/webm'],
      [bytes('ID3\x04\0\0\0\0\0\0'), 'audio/mpeg'],
      [bytes('OggS\0\x02'), 'audio/ogg'],
      [bytes('RIFF\x24\0\0\0WAVEfmt '), 'audio/wav'],
      ['#!AMR\n', 'audio/amr'],
      ['%PDF-1.7\n%fictional', 'application/pdf'],
      [bytes('\0\0junk before the header\n', '%PDF-1.4\n'), 'application/pdf'],
    ];
    for (const [data, mimeType] of cases) {
      const type = await detect(data);
      expect(type === 'program' ? type : type.mimeType).toBe(mimeType);
    }
  });

  it('never trusts the name for the type', async () => {
    expect(await detect(hex('89504e470d0a1a0a0000'), 'notes.txt')).toEqual({
      mimeType: 'image/png',
      kind: 'picture',
    });
    expect(await detect('Fictional notes', 'photo.png')).toEqual({
      mimeType: 'text/plain',
      kind: 'text',
    });
  });

  it('refuses programs by their contents, whatever they are called', async () => {
    const programs: Buffer[] = [
      bytes('MZ', Buffer.alloc(64)), // Windows
      bytes(hex('7f454c46'), Buffer.alloc(16)), // Linux
      bytes(hex('cffaedfe'), Buffer.alloc(16)), // Mac
      bytes(hex('cafebabe'), Buffer.alloc(16)), // Mac universal
      bytes('#!/bin/sh\necho "fictional"\n'), // scripts
      bytes('xar!', Buffer.alloc(16)), // Mac installer
      bytes('!<arch>\ndebian-binary   '), // Debian package
      bytes(hex('edabeedb'), Buffer.alloc(16)), // RPM package
      bytes(hex('4c0000000114020000000000c000000000000046')), // Windows shortcut
      bytes(Buffer.alloc(600), 'koly', Buffer.alloc(508)), // Mac disk image
      ole('84100c0000000000c000000000000046'), // Windows Installer
      zip([['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0']]), // Java
      zip([
        ['AndroidManifest.xml', ''],
        ['classes.dex', ''],
      ]), // Android
      zip([['Payload/Fictional.app/Info.plist', '']]), // iPhone
      zip([['AppxManifest.xml', '']]), // Windows app package
    ];
    for (const program of programs) expect(await detect(program, 'setup.pdf')).toBe('program');
  });

  it('tells Office, OpenDocument and plain ZIP files apart', async () => {
    const docx = zip([
      ['[Content_Types].xml', '<Types/>'],
      ['word/document.xml', '<w:document/>'],
    ]);
    const xlsx = zip([
      ['[Content_Types].xml', '<Types/>'],
      ['xl/workbook.xml', '<workbook/>'],
    ]);
    const odt = zip([
      ['mimetype', 'application/vnd.oasis.opendocument.text'],
      ['content.xml', '<office:document-content/>'],
    ]);
    expect(await detect(docx)).toEqual({
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      kind: 'document',
    });
    expect(await detect(xlsx)).toEqual({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      kind: 'document',
    });
    expect(await detect(odt)).toEqual({
      mimeType: 'application/vnd.oasis.opendocument.text',
      kind: 'document',
    });
    expect(await detect(zip([['notes.txt', 'Fictional']]))).toEqual({
      mimeType: 'application/zip',
      kind: 'other',
    });
    expect(await detect(ole('2008020000000000c000000000000046'), 'Budget.xls')).toEqual({
      mimeType: 'application/vnd.ms-excel',
      kind: 'document',
    });
  });

  it('accepts SVG only as a picture, even with a script inside', async () => {
    const svg = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- A fictional drawing -->',
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ].join('\n');
    expect(await detect(svg, 'drawing.txt')).toEqual({
      mimeType: 'image/svg+xml',
      kind: 'picture',
    });
  });

  it('names text by its ending, and never shows web pages', async () => {
    expect(await detect('name,team\nAna Example,Care\n', 'people.csv')).toEqual({
      mimeType: 'text/csv',
      kind: 'text',
    });
    const page = await detect('<!doctype html><script>alert(1)</script>', 'page.html');
    expect(page).toEqual({ mimeType: 'text/html', kind: 'text' });
    expect(showsInBrowser('text/html')).toBe(false);
    // A character cut off at the end of the sample is still text.
    expect(await detect('€'.repeat(2000), 'euros.txt')).toEqual({
      mimeType: 'text/plain',
      kind: 'text',
    });
    expect(await detect(hex('000102ff'), 'data.txt')).toEqual({
      mimeType: 'application/octet-stream',
      kind: 'other',
    });
  });
});

describe('hasBlockedEnding', () => {
  it('blocks program endings in any case, and the ones the workspace adds', () => {
    expect(hasBlockedEnding('setup.EXE')).toBe(true);
    expect(hasBlockedEnding('install.sh. ')).toBe(true);
    expect(hasBlockedEnding('report.pdf')).toBe(false);
    expect(hasBlockedEnding('archive.tar.gz')).toBe(false);
    expect(hasBlockedEnding('README')).toBe(false);
    expect(hasBlockedEnding('macro.XYZ', ['.xyz'])).toBe(true);
  });
});
