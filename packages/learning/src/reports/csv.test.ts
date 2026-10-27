import { describe, expect, it } from 'vitest';
import { courseReportCsv, toCsv, type CsvCell, type CsvColumn, type EnrollmentRow } from './index';

type Line = { name: CsvCell; note: CsvCell };
const columns: CsvColumn<Line>[] = [
  { header: 'Name', value: (line) => line.name },
  { header: 'Note', value: (line) => line.note },
];
const csv = (...lines: Line[]) => toCsv(columns, lines);

describe('toCsv', () => {
  it('writes a header and one line per row, each ending in CRLF', () => {
    expect(csv({ name: 'Avery Quill', note: 3 }, { name: 'Bram Okafor', note: null })).toBe(
      'Name,Note\r\nAvery Quill,3\r\nBram Okafor,\r\n',
    );
    expect(csv()).toBe('Name,Note\r\n');
  });

  it('quotes commas, quotes, line breaks and edge spaces, doubling inner quotes', () => {
    const out = csv(
      { name: 'Okafor, Bram', note: 'Said "ready"' },
      { name: 'Line one\nLine two', note: 'Carriage\rreturn' },
      { name: ' Cleo', note: 'Varga ' },
      { name: 'Mid space ok', note: '' },
    );
    expect(out).toBe(
      [
        'Name,Note',
        '"Okafor, Bram","Said ""ready"""',
        '"Line one\nLine two","Carriage\rreturn"',
        '" Cleo","Varga "',
        'Mid space ok,',
        '',
      ].join('\r\n'),
    );
  });

  it("prefixes ' to text starting with = + - @ tab or CR, then quotes as needed", () => {
    const out = csv(
      { name: '=SUM(A1:A9)', note: '+44 20 7946 0000' },
      { name: '-5', note: '@everyone' },
      { name: '\tTabbed', note: '\rReturned' },
      { name: '=1,2', note: 'a=b' },
    );
    expect(out.split('\r\n').slice(1, -1)).toEqual([
      "'=SUM(A1:A9),'+44 20 7946 0000",
      "'-5,'@everyone",
      `'\tTabbed,"'\rReturned"`,
      `"'=1,2",a=b`,
    ]);
  });

  it('writes numbers as they are, non-finite numbers and missing cells as empty', () => {
    expect(
      csv(
        { name: -5, note: 2.5 },
        { name: Number.NaN, note: undefined },
        { name: Infinity, note: 0 },
      ),
    ).toBe('Name,Note\r\n-5,2.5\r\n,\r\n,0\r\n');
  });

  it('guards and quotes headers too, and adds a byte order mark on request', () => {
    const out = toCsv([{ header: '=Total, all', value: () => 1 }], [{}], { bom: true });
    expect(out).toBe('\uFEFF"\'=Total, all"\r\n1\r\n');
    expect(out.charCodeAt(0)).toBe(0xfeff);
  });
});

describe('courseReportCsv', () => {
  const row = (learnerName: string, extra: Partial<EnrollmentRow>): EnrollmentRow => ({
    learnerId: `p-${learnerName.split(' ')[0]?.toLowerCase()}`,
    learnerName,
    groupIds: ['g-harbor'],
    courseId: 'c-fire',
    courseTitle: 'Fire safety basics',
    status: 'not_started',
    score: null,
    activeSeconds: 0,
    attempts: 0,
    required: true,
    ...extra,
  });
  const rows = [
    row('Zane Whitcombe', {
      status: 'in_progress',
      activeSeconds: 600,
      startedAt: '2026-10-28T09:00:00.000Z',
    }),
    row('Okafor, Bram', {
      status: 'passed',
      score: 87.6,
      activeSeconds: 1530,
      attempts: 2,
      startedAt: '2026-10-20T15:00:00.000Z',
      completedAt: '2026-10-22T03:30:00.000Z',
      dueDate: '2026-10-30',
    }),
    row('Avery Quill', { dueDate: '2026-10-30' }),
  ];
  const header =
    'Name,Status,Score,Time spent (minutes),Attempts,Started,Completed,Due,Days overdue';

  it("lists every learner by name, including people who haven't started", () => {
    expect(courseReportCsv(rows, '2026-11-02')).toBe(
      [
        header,
        'Avery Quill,Not started,,0,0,,,2026-10-30,3',
        '"Okafor, Bram",Passed,88,26,2,2026-10-20,2026-10-22,2026-10-30,',
        'Zane Whitcombe,In progress,,10,0,2026-10-28,,,',
        '',
      ].join('\r\n'),
    );
  });

  it('reads dates in the workspace time zone and can add a byte order mark', () => {
    const out = courseReportCsv(rows, '2026-11-02', { timeZone: 'America/Denver', bom: true });
    expect(out.startsWith(`\uFEFF${header}\r\n`)).toBe(true);
    expect(out).toContain('"Okafor, Bram",Passed,88,26,2,2026-10-20,2026-10-21,2026-10-30,\r\n');
  });

  it('is just a header without rows', () => {
    expect(courseReportCsv([], '2026-11-02')).toBe(`${header}\r\n`);
  });
});
