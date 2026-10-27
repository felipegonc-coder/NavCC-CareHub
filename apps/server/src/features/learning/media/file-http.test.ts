import { describe, expect, it } from 'vitest';
import { FILE_CSP, contentDisposition, fileHeaders, parseRange } from './file-http';
import type { StoredFile } from './file-store';

const file = (mimeType: string, name = 'Ward map.png'): StoredFile => ({
  id: '0b6f8a8e-9a43-4c1e-8f6e-2f7f4f1d6c11',
  scope: 'learning:course-1',
  name,
  size: 10,
  mimeType,
  createdBy: 'user-1',
  createdAt: '2026-10-27T09:00:00.000Z',
});

describe('fileHeaders', () => {
  it('opens pictures, video, audio and PDFs in the browser, sandboxed and never sniffed', () => {
    for (const type of ['image/png', 'video/mp4', 'audio/mpeg', 'application/pdf']) {
      expect(fileHeaders(file(type), false)).toEqual({
        'content-type': type,
        'content-disposition': `inline; filename="Ward map.png"; filename*=UTF-8''Ward%20map.png`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'private, no-store',
        'accept-ranges': 'bytes',
      });
    }
    expect(FILE_CSP).toContain('sandbox');
  });

  it('downloads everything else, and anything asked for as a download', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    for (const type of [docx, 'text/plain', 'text/csv', 'text/vtt']) {
      expect(fileHeaders(file(type, 'notes.txt'), false)['content-disposition']).toMatch(
        /^attachment; /,
      );
    }
    expect(fileHeaders(file('image/png'), true)['content-disposition']).toMatch(/^attachment; /);
  });
});

describe('contentDisposition', () => {
  it('gives a plain ASCII name and the full UTF-8 name', () => {
    expect(contentDisposition('attachment', 'Plan "B" café (v2).pdf')).toBe(
      `attachment; filename="Plan _B_ caf_ (v2).pdf"; filename*=UTF-8''Plan%20%22B%22%20caf%C3%A9%20%28v2%29.pdf`,
    );
  });
});

describe('parseRange', () => {
  it('reads one byte range', () => {
    expect(parseRange('bytes=0-3', 10)).toEqual({ start: 0, end: 3 });
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 });
    expect(parseRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(parseRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=8-100', 10)).toEqual({ start: 8, end: 9 });
  });

  it('sends the whole file for no range, several ranges or a backwards one', () => {
    for (const header of [undefined, '', 'bytes=0-1,4-5', 'items=0-1', 'bytes=-', 'bytes=5-2']) {
      expect(parseRange(header, 10)).toBeNull();
    }
  });

  it("can't send a range that starts past the end", () => {
    expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-0', 10)).toBe('unsatisfiable');
    expect(parseRange('bytes=-5', 0)).toBe('unsatisfiable');
  });
});
