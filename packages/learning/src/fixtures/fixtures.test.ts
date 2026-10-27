import { describe, expect, it } from 'vitest';
import type { Block, Course } from '../format/index';
import {
  BLOCK_TYPES,
  COURSE_TYPES,
  QUESTION_TYPES,
  allQuestions,
  checkPublishable,
  parseCourse,
  parseLearningPath,
} from '../format/index';
import {
  sampleCertificationCourse,
  sampleCourses,
  sampleGroups,
  sampleLearners,
  sampleLearningPath,
  sampleShowcaseCourse,
  sampleStandardCourse,
} from './index';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const blocksOf = (course: Course): Block[] =>
  course.lessons.flatMap((lesson) => (lesson.kind === 'content' ? lesson.blocks : []));
const blockTypes = (courses: readonly Course[]) =>
  [...new Set(courses.flatMap((course) => blocksOf(course).map((block) => block.type)))].sort();
const questionTypes = (courses: readonly Course[]) =>
  [
    ...new Set(
      courses.flatMap((course) => allQuestions(course).map((found) => found.question.type)),
    ),
  ].sort();

/** Every fixture as one JSON string, for scanning addresses and file ids. */
const everything = JSON.stringify({
  sampleCourses,
  sampleLearningPath,
  sampleLearners,
  sampleGroups,
});

describe('sample courses', () => {
  it('has one course for each course type, then the showcase', () => {
    expect(sampleCourses.slice(0, COURSE_TYPES.length).map((course) => course.type)).toEqual([
      ...COURSE_TYPES,
    ]);
    expect(sampleCourses.at(-1)).toBe(sampleShowcaseCourse);
    expect(new Set(sampleCourses.map((course) => course.id)).size).toBe(sampleCourses.length);
  });

  it('all parse unchanged, from JSON and as they are', () => {
    for (const course of sampleCourses) {
      expect(parseCourse(copy(course))).toStrictEqual({ ok: true, course: copy(course) });
      expect(parseCourse(course)).toStrictEqual({ ok: true, course: copy(course) });
    }
  });

  it('are all publishable', () => {
    for (const course of sampleCourses)
      expect({ id: course.id, problems: checkPublishable(course) }).toEqual({
        id: course.id,
        problems: [],
      });
  });

  it('use all 28 block types and all 8 question types together', () => {
    expect(BLOCK_TYPES.length).toBe(28);
    expect(QUESTION_TYPES.length).toBe(8);
    expect(blockTypes(sampleCourses)).toEqual([...BLOCK_TYPES].sort());
    expect(questionTypes(sampleCourses)).toEqual([...QUESTION_TYPES].sort());
  });

  it('include a showcase that alone holds every block and question type', () => {
    expect(blockTypes([sampleShowcaseCourse])).toEqual([...BLOCK_TYPES].sort());
    expect(questionTypes([sampleShowcaseCourse])).toEqual([...QUESTION_TYPES].sort());
  });

  it('include the Phase 1 test course: 3 lessons, a knowledge check, a 5-question quiz with matching, 60 s on lesson 1', () => {
    const lessons = sampleStandardCourse.lessons;
    const content = lessons.filter((lesson) => lesson.kind === 'content');
    expect(content.length).toBe(3);
    expect(lessons[0]).toMatchObject({ kind: 'content', minimumSeconds: 60 });
    expect(blocksOf(sampleStandardCourse).some((block) => block.type === 'knowledge_check')).toBe(
      true,
    );
    const quiz = lessons.at(-1);
    if (quiz?.kind !== 'quiz') throw new Error('the last lesson should be the final quiz');
    expect(quiz.questions.length).toBe(5);
    expect(quiz.bankDraws).toBe(undefined);
    expect(quiz.questions.some((question) => question.type === 'matching')).toBe(true);
    expect(lessons.length).toBe(4);
  });

  it('include a bank draw with a published snapshot to draw from', () => {
    const draws = sampleCertificationCourse.lessons.flatMap((lesson) =>
      lesson.kind === 'quiz' ? (lesson.bankDraws ?? []) : [],
    );
    expect(draws.length > 0).toBe(true);
    for (const draw of draws) expect((draw.questions?.length ?? 0) > draw.count).toBe(true);
  });
});

describe('sample learning path', () => {
  it('parses unchanged', () => {
    expect(parseLearningPath(copy(sampleLearningPath))).toStrictEqual({
      ok: true,
      learningPath: copy(sampleLearningPath),
    });
  });

  it('only names sample courses, each once', () => {
    const ids = new Set(sampleCourses.map((course) => course.id));
    for (const courseId of sampleLearningPath.courseIds) expect(ids.has(courseId)).toBe(true);
    expect(new Set(sampleLearningPath.courseIds).size).toBe(sampleLearningPath.courseIds.length);
  });
});

describe('sample people', () => {
  it('has 8 learners and 2 groups with unique ids and emails', () => {
    expect(sampleLearners.length).toBe(8);
    expect(sampleGroups.length).toBe(2);
    expect(new Set(sampleLearners.map((learner) => learner.id)).size).toBe(8);
    expect(new Set(sampleGroups.map((group) => group.id)).size).toBe(2);
    expect(new Set(sampleLearners.map((learner) => learner.email)).size).toBe(8);
  });

  it('keeps group members and learner groups in step', () => {
    const groupIds = new Set(sampleGroups.map((group) => group.id));
    for (const learner of sampleLearners) {
      for (const groupId of learner.groupIds) expect(groupIds.has(groupId)).toBe(true);
    }
    for (const group of sampleGroups) {
      const members = sampleLearners.filter((learner) => learner.groupIds.includes(group.id));
      expect(group.memberIds).toEqual(members.map((learner) => learner.id));
      expect(group.memberIds.length > 0).toBe(true);
    }
  });

  it('gives learners managers who are sample learners themselves', () => {
    const ids = new Set(sampleLearners.map((learner) => learner.id));
    const managed = sampleLearners.filter((learner) => learner.managerId !== null);
    expect(managed.length > 0).toBe(true);
    for (const learner of managed) {
      expect(ids.has(learner.managerId ?? '')).toBe(true);
      expect(learner.managerId).not.toBe(learner.id);
    }
  });

  it('uses real IANA time zones', () => {
    for (const learner of sampleLearners) {
      expect(() => new Intl.DateTimeFormat('en-US', { timeZone: learner.timeZone })).not.toThrow();
    }
  });
});

describe('fixture data', () => {
  it('only uses example.org web addresses and example.test emails', () => {
    const hosts = [...everything.matchAll(/https?:\/\/([^/"?#]+)/g)].map((match) => match[1] ?? '');
    expect(hosts.length > 0).toBe(true);
    for (const host of hosts) {
      expect(host === 'example.org' || host.endsWith('.example.org')).toBe(true);
    }
    const emails = [...everything.matchAll(/[\w.+-]+@[\w.-]+/g)].map((match) => match[0]);
    expect(emails.length).toBe(sampleLearners.length);
    for (const email of emails) expect(email.endsWith('@example.test')).toBe(true);
  });

  it('only uses fake file ids', () => {
    const fileIds = [...everything.matchAll(/"fileId":"([^"]*)"/g)].map((match) => match[1] ?? '');
    expect(fileIds.length > 0).toBe(true);
    for (const fileId of fileIds) expect(fileId).toMatch(/^sample-[a-z0-9-]+$/);
  });

  it('is read-only all the way down', () => {
    const unfrozen: string[] = [];
    const walk = (value: unknown, path: string): void => {
      if (value === null || typeof value !== 'object') return;
      if (!Object.isFrozen(value)) unfrozen.push(path);
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    };
    walk({ sampleCourses, sampleLearningPath, sampleLearners, sampleGroups }, 'fixtures');
    expect(unfrozen).toEqual(['fixtures']);
    expect(() => {
      (sampleStandardCourse as { title: string }).title = 'Changed';
    }).toThrow();
    expect(sampleStandardCourse.title).toBe('Handling calls with care');
  });
});
