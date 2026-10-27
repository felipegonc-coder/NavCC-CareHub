import { describe, expect, it } from 'vitest';
import {
  finishedAnnouncement,
  importSummary,
  problemsCsv,
  problemsLabel,
  progressLine,
  progressQuarter,
} from './summary';

const counts = { pages: 1204, databases: 6, rows: 4310, files: 890 };

describe('summary words', () => {
  it('says what came in, leaving out what is zero', () => {
    expect(importSummary(counts, 'Support')).toBe(
      'Imported 1,204 pages, 6 databases, 4,310 rows and 890 files into Support.',
    );
    expect(importSummary({ pages: 3, databases: 0, rows: 0, files: 2 }, 'Support')).toBe(
      'Imported 3 pages and 2 files into Support.',
    );
    expect(importSummary({ pages: 1, databases: 0, rows: 0, files: 0 }, 'Private')).toBe(
      'Imported 1 page into Private.',
    );
  });

  it('shows progress and announces the end', () => {
    expect(progressLine('notion-export.zip', 312, 1204)).toBe(
      'Importing notion-export.zip · 312 of 1,204 pages',
    );
    expect(problemsLabel(1)).toBe('1 problem');
    expect(finishedAnnouncement({ pages: 1204, databases: 0, rows: 0, files: 0 }, 3)).toBe(
      'Import finished. 1,204 pages, 3 problems.',
    );
  });

  it('announces progress every 25%', () => {
    expect([0, 24, 25, 74, 75, 100].map((done) => progressQuarter(done, 100))).toEqual([
      0, 0, 1, 2, 3, 4,
    ]);
    expect(progressQuarter(3, 0)).toBe(0);
  });
});

describe('problemsCsv', () => {
  it('quotes cells and never starts one with a formula', () => {
    expect(
      problemsCsv([
        { file: 'Callbacks.csv', what: 'Total', why: 'Formulas come in as their values.' },
        { file: '=cmd.csv', what: 'Skipped, "odd"', why: '+1\nline' },
      ]),
    ).toBe(
      [
        'File,What happened,Why',
        'Callbacks.csv,Total,Formulas come in as their values.',
        `'=cmd.csv,"Skipped, ""odd""","'+1\nline"`,
        '',
      ].join('\r\n'),
    );
  });
});
