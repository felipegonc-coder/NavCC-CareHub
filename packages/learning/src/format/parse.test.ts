import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Course, LearningPath, Migration } from './index';
import {
  COURSE_MIGRATIONS,
  LEARNING_PATH_MIGRATIONS,
  MAX_ISSUES,
  createCourse,
  formatPath,
  parseCourse,
  parseCourseFile,
  parseLearningPath,
  parseWith,
  richText,
  runMigrations,
  toCourseFile,
} from './index';

// A small fictional course, valid for the schema.
const sample = (): Course => ({
  ...createCourse({ type: 'standard', title: 'Phone basics', id: 'course-1' }),
  lessons: [
    {
      id: 'lesson-1',
      kind: 'content',
      title: 'Greeting',
      blocks: [
        { id: 'b1', type: 'heading', level: 1, text: 'Welcome' },
        { id: 'b2', type: 'paragraph', text: richText("Say your name and the team's name.") },
      ],
    },
  ],
});

const path: LearningPath = {
  formatVersion: 1,
  id: 'path-1',
  title: 'New starter path',
  courseIds: ['course-1', 'course-2'],
  order: 'free',
};

// Fictional version 0: "name" instead of "title".
const renameTitle: Migration = {
  from: 0,
  up: ({ name, ...rest }) => ({ ...rest, title: name }),
};

const issues = (
  result: { ok: true } | { ok: false; issues: { path: string; message: string }[] },
) => (result.ok ? [] : result.issues);

describe('formatPath', () => {
  it('writes paths the way people read them', () => {
    expect(formatPath([])).toBe('');
    expect(formatPath(['title'])).toBe('title');
    expect(formatPath(['lessons', 0, 'blocks', 3, 'text'])).toBe('lessons[0].blocks[3].text');
    expect(formatPath([2, 'id'])).toBe('[2].id');
    expect(formatPath(['matches', 'pair-1'])).toBe('matches["pair-1"]');
    expect(formatPath(['blanks', 'a b'])).toBe('blanks["a b"]');
    expect(formatPath([Symbol('x')])).toBe('["Symbol(x)"]');
  });
});

describe('parseCourse', () => {
  it('returns the course when it is valid', () => {
    const result = parseCourse(sample());
    expect(result).toStrictEqual({ ok: true, course: sample() });
  });

  it('explains problems in plain language with readable paths', () => {
    const course = sample();
    const lesson = course.lessons[0];
    const cases: { change: unknown; path: string; message: string }[] = [
      { change: { ...course, title: undefined }, path: 'title', message: 'Required.' },
      { change: { ...course, title: '' }, path: 'title', message: "Can't be empty." },
      {
        change: { ...course, title: 'x'.repeat(201) },
        path: 'title',
        message: 'Must be at most 200 characters (this has 201).',
      },
      {
        change: { ...course, estimatedMinutes: 1.5 },
        path: 'estimatedMinutes',
        message: 'Must be a whole number.',
      },
      {
        change: { ...course, estimatedMinutes: 601 },
        path: 'estimatedMinutes',
        message: 'Must be at most 600.',
      },
      {
        change: { ...course, estimatedMinutes: 0 },
        path: 'estimatedMinutes',
        message: 'Must be at least 1.',
      },
      { change: { ...course, topics: 'Phones' }, path: 'topics', message: 'Must be a list.' },
      { change: { ...course, html: '<p>hi</p>' }, path: '', message: 'Unknown field "html".' },
      {
        change: { ...course, settings: { ...course.settings, lessonOrder: 'random' } },
        path: 'settings.lessonOrder',
        message: 'Must be one of "free", "sequential".',
      },
      { change: { ...course, formatVersion: '1' }, path: 'formatVersion', message: 'Must be 1.' },
      {
        change: {
          ...course,
          cover: { media: { kind: 'url', url: 'http://example.org/a.png' }, alt: '' },
        },
        path: 'cover.media.url',
        message: 'Use a full https:// address (no user name or password).',
      },
      {
        change: { ...course, lessons: [{ ...lesson, id: 'has space' }] },
        path: 'lessons[0].id',
        message: 'Use 1 to 64 letters, digits, "_" or "-".',
      },
      {
        change: { ...course, lessons: [{ ...lesson, id: 'constructor' }] },
        path: 'lessons[0].id',
        message: 'This id is reserved; choose another.',
      },
      {
        change: {
          ...course,
          lessons: [{ ...lesson, blocks: [{ id: 'b1', type: 'heading', level: 1, text: 5 }] }],
        },
        path: 'lessons[0].blocks[0].text',
        message: 'Must be text.',
      },
      {
        change: {
          ...course,
          lessons: [{ ...lesson, blocks: [{ id: 'b1', type: 'paragraph', text: 'Hi' }] }],
        },
        path: 'lessons[0].blocks[0].text',
        message: 'Must be a list.',
      },
      {
        change: { ...course, settings: { ...course.settings, catalog: { listed: 'yes' } } },
        path: 'settings.catalog.listed',
        message: 'Must be true or false.',
      },
      { change: { ...course, settings: null }, path: 'settings', message: 'Must be an object.' },
    ];
    for (const { change, path, message } of cases)
      expect(issues(parseCourse(change))).toEqual([{ path, message }]);
  });

  it('names the allowed types when a block or lesson type is unknown', () => {
    const course = sample();
    const html = {
      ...course,
      lessons: [
        { ...course.lessons[0], blocks: [{ id: 'b1', type: 'html', html: '<script></script>' }] },
      ],
    };
    const [problem] = issues(parseCourse(html));
    expect(problem?.path).toBe('lessons[0].blocks[0].type');
    expect(
      problem?.message.startsWith(
        'Unknown type "html". Use one of "heading", "paragraph", "list",',
      ),
    ).toBe(true);
    const noKind = { ...course, lessons: [{ id: 'l1', title: 'No kind' }] };
    expect(issues(parseCourse(noKind))[0]?.message).toBe(
      'Missing "kind". Use one of "content", "quiz".',
    );
  });

  it("explains input that isn't a course at all", () => {
    expect(issues(parseCourse(null))).toEqual([{ path: '', message: 'Must be an object.' }]);
    expect(issues(parseCourse('course'))).toEqual([{ path: '', message: 'Must be an object.' }]);
    expect(issues(parseCourse([]))).toEqual([{ path: '', message: 'Must be an object.' }]);
  });

  it(`returns at most ${MAX_ISSUES} problems and says how many more there are`, () => {
    const course = sample();
    const blocks = Array.from({ length: 120 }, (_, i) => ({
      id: `b${i}`,
      type: 'heading',
      level: 9,
      text: 'Hi',
    }));
    const found = issues(parseCourse({ ...course, lessons: [{ ...course.lessons[0], blocks }] }));
    expect(found).toHaveLength(MAX_ISSUES + 1);
    expect(found[0]).toEqual({
      path: 'lessons[0].blocks[0].level',
      message: 'Must be one of 1, 2, 3.',
    });
    expect(found[MAX_ISSUES]).toEqual({ path: '', message: '20 more problems not shown.' });
  });

  it('never throws, even on hostile input', () => {
    const exploding = Object.defineProperty({ ...sample() }, 'title', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(parseCourse(exploding)).toEqual({
      ok: false,
      issues: [{ path: '', message: 'This could not be read.' }],
    });
    const trap = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap');
        },
        get() {
          throw new Error('trap');
        },
      },
    );
    expect(parseCourse(trap).ok).toBe(false);
    expect(parseCourseFile(trap).ok).toBe(false);
    expect(parseLearningPath(trap).ok).toBe(false);
  });
});

describe('migrations', () => {
  it('has none yet: the format is at version 1', () => {
    expect(COURSE_MIGRATIONS).toEqual([]);
    expect(LEARNING_PATH_MIGRATIONS).toEqual([]);
  });

  it('upgrades older courses and says which version they came from', () => {
    const { title, ...rest } = sample();
    const old = { ...rest, formatVersion: 0, name: title };
    const copy: unknown = JSON.parse(JSON.stringify(old));
    const result = parseCourse(old, { migrations: [renameTitle] });
    expect(result).toStrictEqual({ ok: true, course: sample(), migratedFrom: 0 });
    expect(old).toStrictEqual(copy);
  });

  it("refuses versions it can't upgrade", () => {
    const { title, ...rest } = sample();
    expect(issues(parseCourse({ ...rest, formatVersion: 0, name: title }))).toEqual([
      { path: 'formatVersion', message: "Format version 0 can't be upgraded." },
    ]);
    expect(issues(parseCourse({ ...sample(), formatVersion: 2 }))).toEqual([
      {
        path: 'formatVersion',
        message:
          'This course uses format version 2, which is newer than this Care Hub understands (1). Update Care Hub and try again.',
      },
    ]);
  });

  it('reports a migration that fails', () => {
    const broken: Migration = {
      from: 0,
      up: () => {
        throw new Error('bad data');
      },
    };
    expect(
      issues(parseCourse({ ...sample(), formatVersion: 0 }, { migrations: [broken] })),
    ).toEqual([{ path: '', message: 'Upgrading this course from format version 0 failed.' }]);
    const notAnObject: Migration = { from: 0, up: () => [] as unknown as Record<string, unknown> };
    expect(parseCourse({ ...sample(), formatVersion: 0 }, { migrations: [notAnObject] }).ok).toBe(
      false,
    );
  });

  it('runs migrations one version at a time and sets formatVersion after each', () => {
    const seen: number[] = [];
    const step = (from: number): Migration => ({
      from,
      up: (doc) => {
        seen.push(Number(doc.formatVersion));
        return { ...doc, steps: [...(Array.isArray(doc.steps) ? doc.steps : []), from] };
      },
    });
    const result = runMigrations({ formatVersion: 0 }, 3, [step(2), step(0), step(1)], 'course');
    expect(result).toStrictEqual({
      ok: true,
      value: { formatVersion: 3, steps: [0, 1, 2] },
      migratedFrom: 0,
    });
    expect(seen).toEqual([0, 1, 2]);
    expect(runMigrations({ formatVersion: 0 }, 3, [step(0), step(2)], 'course')).toEqual({
      ok: false,
      issues: [{ path: 'formatVersion', message: "Format version 1 can't be upgraded." }],
    });
  });

  it('leaves anything without a whole-number version to the schema', () => {
    for (const raw of [null, 'x', [], { formatVersion: '0' }, { formatVersion: 0.5 }, {}]) {
      expect(runMigrations(raw, 1, [renameTitle], 'course')).toEqual({ ok: true, value: raw });
    }
  });
});

describe('course files', () => {
  it('round-trips a course through export and import', () => {
    const file = toCourseFile(sample(), new Date('2026-10-27T15:00:00.000Z'));
    expect(file).toStrictEqual({
      format: 'carehub.learning.course',
      exportedAt: '2026-10-27T15:00:00.000Z',
      course: sample(),
    });
    expect(parseCourseFile(file)).toStrictEqual({ ok: true, file });
    expect(parseCourseFile(JSON.parse(JSON.stringify(file)))).toStrictEqual({ ok: true, file });
  });

  it("leaves exportedAt out when it isn't given", () => {
    expect(toCourseFile(sample())).toStrictEqual({
      format: 'carehub.learning.course',
      course: sample(),
    });
    expect(toCourseFile(sample(), '2026-10-27T15:00:00Z').exportedAt).toBe('2026-10-27T15:00:00Z');
  });

  it("recognises files that aren't Care Hub courses", () => {
    expect(issues(parseCourseFile([]))).toEqual([
      { path: '', message: 'This is not a Care Hub course file.' },
    ]);
    expect(issues(parseCourseFile(sample()))).toEqual([
      {
        path: 'format',
        message: 'This is not a Care Hub course file (format should be "carehub.learning.course").',
      },
    ]);
  });

  it('points at problems inside the course', () => {
    const file = toCourseFile(sample());
    const course = file.course;
    const broken = {
      ...file,
      course: { ...course, lessons: [{ ...course.lessons[0], title: '' }] },
    };
    expect(issues(parseCourseFile(broken))).toEqual([
      { path: 'course.lessons[0].title', message: "Can't be empty." },
    ]);
    expect(issues(parseCourseFile({ ...file, exportedAt: 'yesterday' }))[0]?.path).toBe(
      'exportedAt',
    );
    expect(
      issues(parseCourseFile({ ...file, course: { ...course, formatVersion: 7 } }))[0]?.path,
    ).toBe('course.formatVersion');
  });

  it('migrates the course inside a file', () => {
    const { title, ...rest } = sample();
    const result = parseCourseFile(
      { format: 'carehub.learning.course', course: { ...rest, formatVersion: 0, name: title } },
      { migrations: [renameTitle] },
    );
    expect(result).toStrictEqual({
      ok: true,
      file: { format: 'carehub.learning.course', course: sample() },
      migratedFrom: 0,
    });
  });
});

describe('parseLearningPath', () => {
  it('returns valid paths', () => {
    expect(parseLearningPath(path)).toStrictEqual({ ok: true, learningPath: path });
  });

  it('explains problems', () => {
    expect(issues(parseLearningPath({ ...path, courseIds: ['a', 'b', 'a'] }))).toEqual([
      { path: 'courseIds[2]', message: 'Course "a" is already in this path.' },
    ]);
    expect(issues(parseLearningPath({ ...path, formatVersion: 3 }))[0]?.message).toBe(
      'This learning path uses format version 3, which is newer than this Care Hub understands (1). Update Care Hub and try again.',
    );
  });

  it('can migrate older paths', () => {
    const old = { ...path, formatVersion: 0 };
    expect(
      parseLearningPath(old, { migrations: [{ from: 0, up: (doc) => ({ ...doc }) }] }),
    ).toStrictEqual({ ok: true, learningPath: path, migratedFrom: 0 });
  });
});

describe('parseWith', () => {
  it('gives readable messages for any schema', () => {
    const check = (schema: z.ZodType, raw: unknown) =>
      issues(parseWith(schema, raw)).map((issue) => issue.message);
    expect(parseWith(z.strictObject({ n: z.number() }), { n: 1 })).toEqual({
      ok: true,
      value: { n: 1 },
    });
    expect(check(z.array(z.string()).min(2), ['a'])).toEqual(['Needs at least 2 items.']);
    expect(check(z.array(z.string()).max(1), ['a', 'b'])).toEqual([
      'Can have at most 1 item (this has 2).',
    ]);
    expect(check(z.string().min(3), 'ab')).toEqual(['Must be at least 3 characters.']);
    expect(check(z.number().gt(0), 0)).toEqual(['Must be more than 0.']);
    expect(check(z.number().lt(5), 5)).toEqual(['Must be less than 5.']);
    expect(check(z.union([z.string(), z.number()]), true)).toEqual([
      "Doesn't match any of the allowed shapes.",
    ]);
    expect(check(z.email(), 'not an email')).toEqual(['Has the wrong format.']);
    expect(
      check(
        z.record(z.string().regex(/^[a-z]+$/, { error: 'Use lowercase letters.' }), z.number()),
        { ABC: 1 },
      ),
    ).toEqual(['Use lowercase letters.']);
    expect(
      check(
        z.string().refine(() => false, { error: 'Custom message.' }),
        'x',
      ),
    ).toEqual(['Custom message.']);
  });
});
