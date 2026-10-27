import { describe, expect, it } from 'vitest';
import {
  dueDateCalendarItems,
  dueStatus,
  expandAssignments,
  myLearning,
  searchCatalog,
  type CatalogCourse,
  type CourseAssignment,
  type LearnerAssignment,
  type LearnerEnrollment,
  type LearningGroup,
} from './index';

// Fictional people, groups and courses only.
const course = (
  id: string,
  title: string,
  extra: Partial<CatalogCourse> = {},
  listed = true,
): CatalogCourse => ({
  id,
  title,
  settings: { catalog: { listed } },
  ...extra,
});

describe('dueStatus', () => {
  const today = '2026-10-20';
  it('is none without a due date', () => {
    expect(dueStatus(undefined, undefined, today)).toBe('none');
    expect(dueStatus(null, '2026-10-19T10:00:00.000Z', today)).toBe('none');
  });

  it('is upcoming, then due soon from 3 days before through the due date, then overdue', () => {
    expect(dueStatus('2026-10-24', undefined, today)).toBe('upcoming');
    expect(dueStatus('2026-10-23', undefined, today)).toBe('due_soon');
    expect(dueStatus('2026-10-20', undefined, today)).toBe('due_soon');
    expect(dueStatus('2026-10-19', undefined, today)).toBe('overdue');
    expect(dueStatus('2026-10-27', undefined, today, 7)).toBe('due_soon');
    expect(dueStatus('2026-10-21', undefined, today, 0)).toBe('upcoming');
  });

  it('tells on-time from late completions, reading the completion day in the time zone', () => {
    expect(dueStatus('2026-10-30', '2026-10-30T23:30:00.000Z', today)).toBe('done_on_time');
    expect(dueStatus('2026-10-30', '2026-10-31T00:30:00.000Z', today)).toBe('done_late');
    expect(dueStatus('2026-10-30', '2026-10-31T00:30:00.000Z', today, 3, 'America/Denver')).toBe(
      'done_on_time',
    );
    expect(dueStatus('2026-10-30', '2026-10-29', '2026-11-02')).toBe('done_on_time');
  });
});

describe('expandAssignments', () => {
  const groups: LearningGroup[] = [
    { id: 'g-harbor', name: 'Harbor House', memberIds: ['p-avery', 'p-bram'] },
    { id: 'g-summit', name: 'Summit Lodge', memberIds: ['p-bram', 'p-cleo'] },
  ];
  const assignments: CourseAssignment[] = [
    {
      id: 'a-1',
      courseId: 'c-fire',
      learnerIds: ['p-avery'],
      groupIds: ['g-harbor'],
      dueDate: '2026-11-10',
      required: false,
    },
    {
      id: 'a-2',
      courseId: 'c-fire',
      groupIds: ['g-summit', 'g-ghost'],
      dueDate: '2026-11-05',
      required: true,
    },
    { id: 'a-3', courseId: 'c-hygiene', learnerIds: ['p-avery'], required: false },
    {
      id: 'a-4',
      courseId: 'c-hygiene',
      groupIds: ['g-harbor'],
      dueDate: '2026-11-20',
      required: false,
    },
  ];

  it('gives each learner one assignment per course: earliest due date, required over optional', () => {
    expect(expandAssignments(assignments, groups)).toEqual([
      {
        learnerId: 'p-avery',
        courseId: 'c-fire',
        dueDate: '2026-11-10',
        required: false,
        assignmentId: 'a-1',
        assignmentIds: ['a-1'],
      },
      {
        learnerId: 'p-bram',
        courseId: 'c-fire',
        dueDate: '2026-11-05',
        required: true,
        assignmentId: 'a-2',
        assignmentIds: ['a-1', 'a-2'],
      },
      {
        learnerId: 'p-cleo',
        courseId: 'c-fire',
        dueDate: '2026-11-05',
        required: true,
        assignmentId: 'a-2',
        assignmentIds: ['a-2'],
      },
      {
        learnerId: 'p-avery',
        courseId: 'c-hygiene',
        dueDate: '2026-11-20',
        required: false,
        assignmentId: 'a-4',
        assignmentIds: ['a-3', 'a-4'],
      },
      {
        learnerId: 'p-bram',
        courseId: 'c-hygiene',
        dueDate: '2026-11-20',
        required: false,
        assignmentId: 'a-4',
        assignmentIds: ['a-4'],
      },
    ]);
  });

  it("assigns a group's courses to people who join it later, and drops them for people who leave", () => {
    const later = [
      { id: 'g-harbor', name: 'Harbor House', memberIds: ['p-avery', 'p-dax'] },
      groups[1] as LearningGroup,
    ];
    const forFire = (list: LearnerAssignment[]) =>
      list
        .filter((item) => item.courseId === 'c-fire')
        .map((item) => [item.learnerId, item.dueDate, item.required]);
    expect(forFire(expandAssignments(assignments, groups))).not.toContainEqual([
      'p-dax',
      '2026-11-10',
      false,
    ]);
    expect(forFire(expandAssignments(assignments, later))).toEqual([
      ['p-avery', '2026-11-10', false],
      ['p-dax', '2026-11-10', false],
      ['p-bram', '2026-11-05', true],
      ['p-cleo', '2026-11-05', true],
    ]);
  });

  it('ignores unknown groups and is empty without assignments', () => {
    expect(
      expandAssignments(
        [{ id: 'a-9', courseId: 'c-fire', groupIds: ['g-ghost'], required: true }],
        groups,
      ),
    ).toEqual([]);
    expect(expandAssignments([], groups)).toEqual([]);
  });
});

describe('myLearning', () => {
  const today = '2026-11-02';
  const catalog = [
    course('c-fire', 'Fire safety basics'),
    course('c-hygiene', 'Hand hygiene'),
    course('c-lifting', 'Safe lifting'),
    course('c-dementia', 'Dementia care'),
    course('c-meds', 'Medication rounds', {}, false),
    course('c-wound', 'Wound care'),
    course('c-sepsis', 'Sepsis signs'),
    course('c-falls', 'Falls prevention'),
    course('c-privacy', 'Privacy at work'),
  ];
  const assigned = (courseId: string, dueDate?: string): LearnerAssignment => ({
    learnerId: 'p-esme',
    courseId,
    ...(dueDate !== undefined && { dueDate }),
    required: true,
    assignmentId: `a-${courseId}`,
    assignmentIds: [`a-${courseId}`],
  });
  const assignments = [
    assigned('c-privacy'),
    assigned('c-fire', '2026-11-05'),
    assigned('c-meds', '2026-10-30'),
    assigned('c-lifting', '2026-10-25'),
    assigned('c-hygiene'),
    assigned('c-sepsis', '2026-10-15'),
    assigned('c-ghost', '2026-11-01'),
  ];
  const enrollments: LearnerEnrollment[] = [
    {
      courseId: 'c-hygiene',
      status: 'in_progress',
      startedAt: '2026-10-20T09:00:00.000Z',
      lastActivityAt: '2026-11-01T10:00:00.000Z',
    },
    { courseId: 'c-lifting', status: 'in_progress', startedAt: '2026-10-21T09:00:00.000Z' },
    { courseId: 'c-dementia', status: 'in_progress', startedAt: '2026-10-31T08:00:00.000Z' },
    { courseId: 'c-wound', status: 'not_started' },
    {
      courseId: 'c-falls',
      status: 'completed',
      startedAt: '2026-10-27T09:00:00.000Z',
      completedAt: '2026-10-28T12:00:00.000Z',
    },
    {
      courseId: 'c-sepsis',
      status: 'failed',
      startedAt: '2026-10-10T09:00:00.000Z',
      lastActivityAt: '2026-10-12T09:00:00.000Z',
    },
  ];
  const page = myLearning(enrollments, assignments, catalog, today);
  const ids = (items: { course: CatalogCourse }[]) => items.map((item) => item.course.id);

  it("sorts each course into one section, in each section's order", () => {
    expect(ids(page.continue)).toEqual(['c-hygiene', 'c-dementia']);
    expect(ids(page.assigned)).toEqual(['c-fire', 'c-privacy']);
    expect(ids(page.overdue)).toEqual(['c-lifting', 'c-meds']);
    expect(ids(page.finished)).toEqual(['c-falls', 'c-sepsis']);
  });

  it('carries the status, enrollment, assignment and due status of each card', () => {
    expect(page.assigned[0]).toEqual({
      course: catalog[0],
      status: 'not_started',
      assignment: assignments[1],
      dueStatus: 'due_soon',
    });
    expect(page.overdue[1]).toMatchObject({ status: 'not_started', dueStatus: 'overdue' });
    expect(page.finished[0]).toMatchObject({
      status: 'completed',
      enrollment: enrollments[4],
      dueStatus: 'none',
    });
    expect(page.continue[1]?.assignment).toBeUndefined();
  });

  it('lists listed courses in the catalog with an enrolled flag', () => {
    expect(page.catalog.map((entry) => [entry.course.id, entry.enrolled])).toEqual([
      ['c-fire', true],
      ['c-hygiene', true],
      ['c-lifting', true],
      ['c-dementia', true],
      ['c-wound', false],
      ['c-sepsis', true],
      ['c-falls', true],
      ['c-privacy', true],
    ]);
  });

  it('is empty for a new learner', () => {
    expect(myLearning([], [], catalog, today)).toMatchObject({
      continue: [],
      assigned: [],
      overdue: [],
      finished: [],
    });
  });
});

describe('searchCatalog', () => {
  const courses = [
    course('c-cv', 'Résumé writing for carers', { topics: ['Careers'] }),
    course('c-fire', 'Fire safety basics', { topics: ['Safety', 'Fire'] }),
    course('c-marshal', 'Fire marshal refresher', { topics: ['Fire'] }, false),
    course('c-lifting', 'Safe lifting', {
      summary: 'Protect your back when moving residents',
      topics: ['Safety'],
    }),
  ];
  const search = (query: string, topic?: string) =>
    searchCatalog(courses, query, topic).map((item) => item.id);

  it('matches every word in the title, summary or topics, ignoring case and accents', () => {
    expect(search('resume')).toEqual(['c-cv']);
    expect(search('RÉSUMÉ Carers')).toEqual(['c-cv']);
    expect(search('FIRE')).toEqual(['c-fire']);
    expect(search('safety back')).toEqual(['c-lifting']);
    expect(search('  fire   safety ')).toEqual(['c-fire']);
    expect(search('sepsis')).toEqual([]);
  });

  it('lists every listed course for an empty query and filters by exact topic', () => {
    expect(search('')).toEqual(['c-cv', 'c-fire', 'c-lifting']);
    expect(search('', 'Safety')).toEqual(['c-fire', 'c-lifting']);
    expect(search('back', 'Safety')).toEqual(['c-lifting']);
    expect(search('', 'safety')).toEqual([]);
  });
});

describe('dueDateCalendarItems', () => {
  const courses = [
    course('c-fire', 'Fire safety basics'),
    course('c-hygiene', 'Hand hygiene'),
    course('c-meds', 'Medication rounds'),
  ];
  const items = [
    { assignmentId: 'a-7', courseId: 'c-hygiene', dueDate: '2026-11-05' },
    { assignmentId: 'a-8', courseId: 'c-meds', dueDate: '2026-10-30' },
    { assignmentId: 'a-9', courseId: 'c-fire', dueDate: '2026-11-05' },
    { assignmentId: 'a-10', courseId: 'c-privacy' },
    { assignmentId: 'a-11', courseId: 'c-ghost', dueDate: '2026-11-03' },
  ];

  it('turns due dates into the items Team tools reads, by date then title', () => {
    expect(dueDateCalendarItems(items, courses)).toEqual([
      {
        assignmentId: 'a-8',
        courseId: 'c-meds',
        title: 'Medication rounds',
        dueDate: '2026-10-30',
        href: '/learning/courses/c-meds',
      },
      {
        assignmentId: 'a-9',
        courseId: 'c-fire',
        title: 'Fire safety basics',
        dueDate: '2026-11-05',
        href: '/learning/courses/c-fire',
      },
      {
        assignmentId: 'a-7',
        courseId: 'c-hygiene',
        title: 'Hand hygiene',
        dueDate: '2026-11-05',
        href: '/learning/courses/c-hygiene',
      },
    ]);
  });

  it('leaves out finished courses and days outside from..to', () => {
    const statusByCourse = { 'c-fire': 'passed', 'c-meds': 'failed' } as const;
    const ids = (list: { assignmentId: string }[]) => list.map((item) => item.assignmentId);
    expect(ids(dueDateCalendarItems(items, courses, { statusByCourse }))).toEqual(['a-8', 'a-7']);
    expect(
      ids(dueDateCalendarItems(items, courses, { from: '2026-10-31', to: '2026-11-05' })),
    ).toEqual(['a-9', 'a-7']);
    expect(dueDateCalendarItems(items, courses, { from: '2026-11-06' })).toEqual([]);
  });

  it('uses the assignment that set the due date when several reach a learner', () => {
    const groups: LearningGroup[] = [
      { id: 'g-harbor', name: 'Harbor House', memberIds: ['p-avery'] },
    ];
    const merged = expandAssignments(
      [
        {
          id: 'a-late',
          courseId: 'c-fire',
          groupIds: ['g-harbor'],
          dueDate: '2026-11-20',
          required: true,
        },
        {
          id: 'a-soon',
          courseId: 'c-fire',
          learnerIds: ['p-avery'],
          dueDate: '2026-11-06',
          required: true,
        },
      ],
      groups,
    );
    expect(
      dueDateCalendarItems(merged, courses).map((item) => [item.assignmentId, item.dueDate]),
    ).toEqual([['a-soon', '2026-11-06']]);
  });
});
