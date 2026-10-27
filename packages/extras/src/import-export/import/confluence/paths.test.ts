import { describe, expect, it } from 'vitest';
import { entryOf, spaceFolder } from './paths';

const names = new Set([
  'CARE/index.html',
  'CARE/Intake_65540.html',
  'CARE/Visit notes_65541.html',
  'CARE/attachments/65540/65542.png',
  'CARE/attachments/65540/form 1.pdf',
  'outside.txt',
]);

describe('entryOf', () => {
  it("finds a link's entry from the page's folder, without its query or #part", () => {
    const page = 'CARE/Intake_65540.html';
    expect(entryOf(page, 'attachments/65540/65542.png?width=300', names)).toBe(
      'CARE/attachments/65540/65542.png',
    );
    expect(entryOf(page, './Visit%20notes_65541.html#Visitnotes-Before', names)).toBe(
      'CARE/Visit notes_65541.html',
    );
    expect(entryOf(page, 'attachments/65540/form 1.pdf', names)).toBe(
      'CARE/attachments/65540/form 1.pdf',
    );
    expect(entryOf(page, '../outside.txt', names)).toBe('outside.txt');
    expect(entryOf('CARE/attachments/65540/x.html', '../../index.html', names)).toBe(
      'CARE/index.html',
    );
  });

  it('finds nothing for web addresses, other schemes, the root, a missing file or the way out', () => {
    const page = 'CARE/Intake_65540.html';
    for (const href of [
      '',
      '#Intake-Forms',
      'https://wiki.example.test/display/CARE/Intake',
      'javascript:alert(1)',
      '/CARE/index.html',
      '//example.test/x.png',
      'Discharge_65599.html',
      '../../CARE/index.html',
      '%E0%A4%A.html',
    ]) {
      expect(entryOf(page, href, names)).toBeNull();
    }
  });
});

describe('spaceFolder', () => {
  it("is the folder of the space's index.html, or of its first page", () => {
    expect(spaceFolder([...names, 'CARE/attachments/1/index.html'])).toBe('CARE/');
    expect(spaceFolder(['b.html', 'a.html'])).toBe('');
    expect(spaceFolder(['X/Y/b.html', 'X/Y/a.html'])).toBe('X/Y/');
    expect(spaceFolder([])).toBe('');
  });
});
