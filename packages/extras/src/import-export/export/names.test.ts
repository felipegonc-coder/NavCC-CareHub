import { describe, expect, it } from 'vitest';
import { ExportNames, fileStem, joinPath, relativeLink, splitFileName } from './names';

describe('fileStem', () => {
  it('replaces characters that are not allowed in file names with "-"', () => {
    expect(fileStem('Refunds: steps/notes?')).toBe('Refunds- steps-notes-');
    expect(fileStem('a<b>c"d\\e|f*g')).toBe('a-b-c-d-e-f-g');
    expect(fileStem('Tab\there')).toBe('Tab-here');
  });

  it('trims to 100 characters without cutting an emoji in half', () => {
    expect(Array.from(fileStem('x'.repeat(150)))).toHaveLength(100);
    const stem = fileStem(`${'y'.repeat(99)}😀😀`);
    expect(Array.from(stem)).toHaveLength(100);
    expect(stem.endsWith('😀')).toBe(true);
  });

  it('never gives an empty, hidden or reserved name', () => {
    expect(fileStem('   ')).toBe('Untitled');
    expect(fileStem('...')).toBe('Untitled');
    expect(fileStem('.env notes')).toBe('-env notes');
    expect(fileStem('Notes. ')).toBe('Notes');
    expect(fileStem('CON')).toBe('CON-');
  });

  it('splits file names into a clean stem and a lowercase extension', () => {
    expect(splitFileName('Intake chart.PNG')).toEqual({ stem: 'Intake chart', ext: '.png' });
    expect(splitFileName('notes')).toEqual({ stem: 'notes', ext: '' });
    expect(splitFileName('a:b.pdf')).toEqual({ stem: 'a-b', ext: '.pdf' });
  });
});

describe('ExportNames', () => {
  it('numbers repeats in the same folder, ignoring case, and keeps a page with its folder', () => {
    const names = new ExportNames();
    expect(names.take('', 'Refund steps', ['.md', ''])).toBe('Refund steps');
    expect(names.take('', 'refund steps', ['.md', ''])).toBe('refund steps (2)');
    expect(names.take('', 'Refund steps', ['.md'])).toBe('Refund steps (3)');
    expect(names.take('Other', 'Refund steps', ['.md'])).toBe('Refund steps');
  });

  it('skips a number whose folder is already taken by a file', () => {
    const names = new ExportNames();
    names.take('', 'Notes (2)', ['']);
    names.take('', 'Notes', ['.md', '']);
    expect(names.take('', 'Notes', ['.md', ''])).toBe('Notes (3)');
  });
});

describe('relativeLink', () => {
  it('links between files in the same, deeper and higher folders', () => {
    expect(relativeLink('Guide.md', 'Guide/Steps.md')).toBe('Guide/Steps.md');
    expect(relativeLink('Guide/Steps.md', 'Guide.md')).toBe('../Guide.md');
    expect(relativeLink('A/B/C.md', 'A/D/E.md')).toBe('../D/E.md');
    expect(relativeLink('A/B.md', 'A/B/pic.png')).toBe('B/pic.png');
  });

  it('encodes spaces, brackets and # so the link stays whole', () => {
    expect(relativeLink('a.md', 'Refund steps (2).md')).toBe('Refund%20steps%20%282%29.md');
    expect(relativeLink('a.md', 'Q#1 [draft].md')).toBe('Q%231%20%5Bdraft%5D.md');
    expect(decodeURIComponent(relativeLink('a.md', 'Café notes.md'))).toBe('Café notes.md');
  });

  it('joins folders', () => {
    expect(joinPath('', 'a.md')).toBe('a.md');
    expect(joinPath('x/y', 'a.md')).toBe('x/y/a.md');
  });
});
