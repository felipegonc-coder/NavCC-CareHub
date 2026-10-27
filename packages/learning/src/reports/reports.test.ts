import { describe, expect, it } from 'vitest';
import {
  courseReport,
  dropOff,
  overdueList,
  personTranscript,
  reportsOverview,
  teamView,
  type EnrollmentRow,
} from './index';

// Fictional people, teams and courses only.
const NAMES = [
  'Avery Quill',
  'Bram Okafor',
  'Cleo Varga',
  'Dax Holloway',
  'Esme Tran',
  'Felix Moreau',
  'Greta Lindqvist',
  'Hugo Pemberton',
  'Iris Nakamura',
  'Jonah Reyes',
  'Kira Abernathy',
  'Leo Castellano',
  'Mira Osei',
  'Nico Bramwell',
  'Opal Sinclair',
  'Pax Delgado',
  'Quinn Harlow',
  'Rhea Petrov',
  'Silas Fairweather',
  'Tess Okonkwo',
  'Uma Calloway',
  'Vince Albright',
  'Wren Takahashi',
  'Xavi Montague',
  'Yara Ellington',
  'Zane Whitcombe',
  'Ada Brightwater',
  'Bo Kingsley',
  'Cyra Ashdown',
  'Dev Marlowe',
];

function row(fields: Partial<EnrollmentRow> & Pick<EnrollmentRow, 'learnerId'>): EnrollmentRow {
  return {
    learnerName: fields.learnerId,
    groupIds: [],
    courseId: 'calm-callbacks',
    courseTitle: 'Calm Callbacks',
    status: 'not_started',
    score: null,
    activeSeconds: 0,
    attempts: 0,
    required: true,
    ...fields,
  };
}

const DUE = '2026-10-30'; // a Friday
const NEW_HIRE_DUE = '2026-11-06';
const TODAY = '2026-11-02'; // the Monday after

/** The PRD example: 30 learners, 24 complete, 4 in progress, 2 not started, 3 overdue. */
function prdExample(): EnrollmentRow[] {
  return NAMES.map((learnerName, i) => {
    const learnerId = `learner-${String(i + 1).padStart(2, '0')}`;
    const groupIds = [
      i < 15 ? 'harbor' : 'summit',
      ...([26, 27, 29].includes(i) ? ['new-hires'] : []),
    ];
    const base = {
      learnerId,
      learnerName,
      groupIds,
      dueDate: [26, 27, 29].includes(i) ? NEW_HIRE_DUE : DUE,
    };
    if (i < 24) {
      const finishedDay = i < 20 ? 21 + (i % 9) : 31; // four people finished after the due date
      return row({
        ...base,
        status: 'passed',
        score: 80 + (i % 5) * 5,
        activeSeconds: 1200 + i * 60,
        attempts: 1 + (i % 2),
        startedAt: '2026-10-20T15:00:00.000Z',
        completedAt: `2026-10-${finishedDay}T16:00:00.000Z`,
        lastLessonId: 'quiz',
      });
    }
    if (i < 28) {
      return row({
        ...base,
        status: 'in_progress',
        score: i === 25 ? 60 : null,
        activeSeconds: 300,
        attempts: i === 25 ? 1 : 0,
        startedAt: '2026-10-26T15:00:00.000Z',
        lastLessonId: i === 24 ? 'booking' : i === 25 ? 'quiz' : 'why',
      });
    }
    return row(base);
  });
}

describe('courseReport', () => {
  it('matches the PRD example: 24 of 30 complete, 4 in progress, 2 not started, 3 overdue', () => {
    expect(courseReport(prdExample(), TODAY)).toEqual({
      total: 30,
      notStarted: 2,
      inProgress: 4,
      completed: 0,
      passed: 24,
      failed: 0,
      overdue: 3,
      completionPercent: 80,
      averageScore: 88, // (2150 + 60) / 25 = 88.4
      averageActiveSeconds: 1890,
    });
  });

  it('is zero-safe', () => {
    expect(courseReport([], TODAY)).toEqual({
      total: 0,
      notStarted: 0,
      inProgress: 0,
      completed: 0,
      passed: 0,
      failed: 0,
      overdue: 0,
      completionPercent: 0,
      averageScore: null,
      averageActiveSeconds: null,
    });
  });

  it('counts completed and passed as finished, but not failed; failed past the due date is overdue', () => {
    const report = courseReport(
      [
        row({ learnerId: 'a', status: 'completed', activeSeconds: 600, dueDate: DUE }),
        row({ learnerId: 'b', status: 'failed', score: 40, activeSeconds: 900, dueDate: DUE }),
        row({ learnerId: 'c', status: 'in_progress', dueDate: TODAY }), // due today: not overdue yet
      ],
      TODAY,
    );
    expect(report).toMatchObject({
      completed: 1,
      failed: 1,
      inProgress: 1,
      overdue: 1,
      completionPercent: 33,
    });
    expect(report.averageScore).toBe(40);
    expect(report.averageActiveSeconds).toBe(600);
  });
});

describe('teamView', () => {
  it('gives each group its numbers, counting a learner in every group they belong to', () => {
    const groups = [
      { id: 'harbor', name: 'Team Harbor' },
      { id: 'summit', name: 'Team Summit' },
      { id: 'new-hires', name: 'New hires' },
      { id: 'night', name: 'Night shift' },
    ];
    const view = teamView(prdExample(), groups, TODAY);
    expect(view.map((g) => g.groupName)).toEqual([
      'Team Harbor',
      'Team Summit',
      'New hires',
      'Night shift',
    ]);
    expect(view[0]).toMatchObject({
      learners: 15,
      total: 15,
      passed: 15,
      overdue: 0,
      completionPercent: 100,
      averageScore: 90,
    });
    expect(view[1]).toMatchObject({
      learners: 15,
      passed: 9,
      inProgress: 4,
      notStarted: 2,
      overdue: 3,
      completionPercent: 60,
    });
    expect(view[1]).toMatchObject({ averageScore: 86, averageActiveSeconds: 2340 });
    expect(view[2]).toMatchObject({
      learners: 3,
      inProgress: 2,
      notStarted: 1,
      overdue: 0,
      completionPercent: 0,
      averageScore: null,
    });
    expect(view[3]).toMatchObject({
      groupId: 'night',
      learners: 0,
      total: 0,
      completionPercent: 0,
    });
  });
});

describe('overdueList', () => {
  it('lists who is late on which course, most late first, then by name', () => {
    const list = overdueList(prdExample(), TODAY);
    expect(list.map((entry) => [entry.learnerName, entry.daysOverdue])).toEqual([
      ['Cyra Ashdown', 3],
      ['Yara Ellington', 3],
      ['Zane Whitcombe', 3],
    ]);
    expect(list[0]).toMatchObject({
      courseTitle: 'Calm Callbacks',
      dueDate: DUE,
      status: 'not_started',
    });
  });

  it('orders by days late and leaves out finished, undated and not-yet-due rows', () => {
    const list = overdueList(
      [
        row({
          learnerId: 'a',
          learnerName: 'Opal Sinclair',
          status: 'in_progress',
          dueDate: '2026-11-01',
        }),
        row({ learnerId: 'b', learnerName: 'Pax Delgado', dueDate: '2026-10-12' }),
        row({
          learnerId: 'c',
          learnerName: 'Quinn Harlow',
          status: 'passed',
          dueDate: '2026-10-01',
        }),
        row({ learnerId: 'd', learnerName: 'Rhea Petrov', status: 'in_progress' }),
        row({ learnerId: 'e', learnerName: 'Silas Fairweather', dueDate: TODAY }),
      ],
      TODAY,
    );
    expect(list.map((entry) => [entry.learnerName, entry.daysOverdue])).toEqual([
      ['Pax Delgado', 21],
      ['Opal Sinclair', 1],
    ]);
  });
});

describe('personTranscript', () => {
  it("lists one person's courses newest first, with courses not started last", () => {
    const rows = [
      row({
        learnerId: 'a',
        courseId: 'c1',
        courseTitle: 'Refund Rules',
        status: 'completed',
        startedAt: '2026-10-01T09:00:00.000Z',
        completedAt: '2026-10-03T09:00:00.000Z',
      }),
      row({ learnerId: 'a', courseId: 'c2', courseTitle: 'Tone of Voice' }),
      row({
        learnerId: 'a',
        courseId: 'c3',
        courseTitle: 'Calm Callbacks',
        status: 'in_progress',
        startedAt: '2026-09-20T09:00:00.000Z',
        lastActivityAt: '2026-10-28T09:00:00.000Z',
      }),
      row({
        learnerId: 'a',
        courseId: 'c4',
        courseTitle: 'Chat Etiquette',
        status: 'failed',
        startedAt: '2026-10-10T09:00:00Z',
      }),
      row({ learnerId: 'a', courseId: 'c5', courseTitle: 'Privacy Basics' }),
    ];
    expect(personTranscript(rows).map((r) => r.courseTitle)).toEqual([
      'Calm Callbacks',
      'Chat Etiquette',
      'Refund Rules',
      'Privacy Basics',
      'Tone of Voice',
    ]);
  });
});

describe('dropOff', () => {
  it('counts where unfinished learners stopped, in course order', () => {
    const course = {
      id: 'calm-callbacks',
      lessons: [
        { id: 'why', title: 'Why callbacks matter' },
        { id: 'booking', title: 'Booking the callback' },
        { id: 'quiz', title: 'Check your skills' },
      ],
    };
    const rows = [
      ...prdExample(),
      row({
        learnerId: 'other',
        courseId: 'refund-rules',
        status: 'in_progress',
        lastLessonId: 'why',
      }),
    ];
    expect(dropOff(course, rows)).toEqual([
      { lessonId: 'why', title: 'Why callbacks matter', stopped: 2, percent: 33 },
      { lessonId: 'booking', title: 'Booking the callback', stopped: 1, percent: 17 },
      { lessonId: 'quiz', title: 'Check your skills', stopped: 1, percent: 17 },
    ]);
    expect(dropOff(course, [])).toEqual(
      course.lessons.map((l) => ({ lessonId: l.id, title: l.title, stopped: 0, percent: 0 })),
    );
  });
});

describe('reportsOverview', () => {
  const rows = [
    row({
      learnerId: 'a',
      status: 'passed',
      startedAt: '2026-10-20T15:00:00.000Z',
      completedAt: '2026-11-02T20:00:00.000Z',
    }),
    row({
      learnerId: 'b',
      status: 'in_progress',
      startedAt: '2026-10-12T15:00:00.000Z',
      lastActivityAt: '2026-10-27T03:00:00.000Z',
    }),
    row({
      learnerId: 'b',
      courseId: 'refund-rules',
      status: 'in_progress',
      startedAt: '2026-10-01T15:00:00.000Z',
    }),
    row({ learnerId: 'c', status: 'in_progress', startedAt: '2026-10-26T12:00:00.000Z' }),
    row({
      learnerId: 'd',
      status: 'failed',
      startedAt: '2026-10-10T15:00:00.000Z',
      completedAt: '2026-10-20T15:00:00.000Z',
    }),
    row({ learnerId: 'e', status: 'completed', completedAt: '2026-10-22T15:00:00.000Z' }),
    row({ learnerId: 'f', dueDate: '2026-10-30' }),
  ];

  it('gives active learners and completions for the 7 days up to today, all completions and the pass rate', () => {
    expect(reportsOverview(rows, TODAY)).toEqual({
      learners: 6,
      activeLearners: 2, // a and b; c's activity on Oct 26 is 8 days ago
      completions: 2,
      completionsThisWeek: 1,
      passRate: 50,
      overdue: 1,
    });
  });

  it('reads date-times in the workspace time zone', () => {
    // 2026-10-27T03:00Z is still Oct 26 in Denver, so b drops out of the week.
    expect(reportsOverview(rows, TODAY, { timeZone: 'America/Denver' }).activeLearners).toBe(1);
  });

  it('is zero-safe', () => {
    expect(reportsOverview([], TODAY)).toEqual({
      learners: 0,
      activeLearners: 0,
      completions: 0,
      completionsThisWeek: 0,
      passRate: null,
      overdue: 0,
    });
  });
});
