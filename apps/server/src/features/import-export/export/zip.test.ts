import { describe, expect, it } from 'vitest';
import { readZip } from './testing';
import { ExportTooLargeError, ZipWriter } from './zip';

describe('ZipWriter', () => {
  it('writes files that read back the same, deflated or stored, with UTF-8 names', async () => {
    const zip = new ZipWriter({ maxBytes: 1_000_000, now: new Date(2026, 9, 27, 9, 30) });
    const guide = `# Intake guide\n\n${'Ask about allergies. '.repeat(50)}\n`;
    const picture = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    await zip.add('Intake guide.md', guide);
    const notes = '# Café notes (2)\n';
    await zip.add('Intake guide/Café notes (2).md', notes);
    await zip.add('Intake guide/chart.png', picture, { compress: false });
    await zip.add('Empty.md', '');
    const files = readZip(zip.finish());
    expect([...files.keys()]).toEqual([
      'Intake guide.md',
      'Intake guide/Café notes (2).md',
      'Intake guide/chart.png',
      'Empty.md',
    ]);
    expect(files.get('Intake guide.md')?.toString('utf8')).toBe(guide);
    expect(files.get('Intake guide/chart.png')).toEqual(picture);
    expect(files.get('Empty.md')?.length).toBe(0);
    expect(zip.contentBytes).toBe(Buffer.byteLength(guide) + Buffer.byteLength(notes) + 8);
  });

  it('deflates text and stores what deflate would not shrink', async () => {
    const zip = new ZipWriter({ maxBytes: 1_000_000 });
    await zip.add('a.md', 'x'.repeat(10_000));
    await zip.add('b.bin', Buffer.from([1]));
    const out = zip.finish();
    expect(out.readUInt16LE(8)).toBe(8);
    expect(out.length).toBeLessThan(1_000);
  });

  it('refuses to grow past its cap', async () => {
    const zip = new ZipWriter({ maxBytes: 10 });
    await zip.add('a.md', '12345');
    await expect(zip.add('b.md', '123456')).rejects.toThrow(ExportTooLargeError);
  });

  it('takes only relative, unique paths', async () => {
    const zip = new ZipWriter({ maxBytes: 100 });
    for (const path of ['/etc/passwd', '../up.md', 'a//b.md', 'a\\b.md', './a.md', '']) {
      await expect(zip.add(path, 'x')).rejects.toThrow(TypeError);
    }
    await zip.add('Notes.md', 'x');
    await expect(zip.add('notes.md', 'y')).rejects.toThrow(TypeError);
  });
});
