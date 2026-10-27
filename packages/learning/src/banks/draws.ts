import {
  checkPublishable,
  LIMITS,
  type BankDraw,
  type Course,
  type Id,
  type Lesson,
  type PublishProblem,
  type QuizLesson,
} from '../format/index';
import type { QuestionBank } from './bank';
import { idAllocator, lessonName } from './internal';

/** A problem with a quiz lesson's bank draw: a publish problem that also names the lesson and the bank. */
export type BankDrawIssue = PublishProblem & { lessonId: Id; bankId: Id };

/** The course with every bank draw's snapshot filled in, plus the bank problems that should stop publishing. */
export type ResolvedBankDraws = { course: Course; issues: BankDrawIssue[] };

/** The course as it would be published (snapshots filled in) and everything that stops it from being published. */
export type BankPublishCheck = { course: Course; problems: PublishProblem[] };

/** Ids of the banks a course draws from, each once, in course order (the banks to load before publishing). */
export function bankIdsUsed(course: Course): Id[] {
  const ids = new Set<Id>();
  for (const lesson of course.lessons)
    if (lesson.kind === 'quiz') for (const draw of lesson.bankDraws ?? []) ids.add(draw.bankId);
  return [...ids];
}

/** Lesson, block and question ids the course already uses, leaving out bank snapshots (they get replaced). */
function idsInCourse(course: Course): Set<string> {
  const ids = new Set<string>();
  for (const lesson of course.lessons) {
    ids.add(lesson.id);
    if (lesson.kind === 'quiz') {
      for (const question of lesson.questions) ids.add(question.id);
      continue;
    }
    for (const block of lesson.blocks) {
      ids.add(block.id);
      if (block.type === 'knowledge_check') ids.add(block.question.id);
    }
  }
  return ids;
}

const questions = (n: number) => `${n} ${n === 1 ? 'question' : 'questions'}`;

/**
 * The publishing step for question banks: copies each drawn bank's questions into its draw
 * (`bankDraws[i].questions`), so the live version keeps working whatever later happens to the bank.
 * Snapshot question ids stay as they are in the bank unless the course already uses them (for example when two
 * quizzes draw from the same bank); those get `-2`, `-3`, … so question ids stay unique across the course.
 * Reports a bank that no longer exists (that draw gets no snapshot) and a bank with fewer questions than the
 * draw asks for. Everything else about the drawn questions is for `checkPublishable` (or use
 * `checkPublishableWithBanks`). The same course and banks always give the same result; neither input is changed,
 * though snapshot questions share their nested values with `banks`.
 */
export function resolveBankDraws(
  course: Course,
  banks: readonly QuestionBank[],
): ResolvedBankDraws {
  const byId = new Map(banks.map((bank) => [bank.id, bank]));
  const allocate = idAllocator(idsInCourse(course));
  const issues: BankDrawIssue[] = [];

  const lessons = course.lessons.map((lesson, lessonIndex): Lesson => {
    if (lesson.kind !== 'quiz' || lesson.bankDraws === undefined) return lesson;
    const name = lessonName(lessonIndex, lesson.title);
    const bankDraws = lesson.bankDraws.map((draw, drawIndex): BankDraw => {
      const path = `lessons[${lessonIndex}].bankDraws[${drawIndex}]`;
      const report = (message: string, at: string) =>
        issues.push({
          path: at,
          lessonId: lesson.id,
          bankId: draw.bankId,
          message: `${name}: ${message}`,
        });
      const bank = byId.get(draw.bankId);
      if (bank === undefined) {
        report(
          `draws from a question bank that no longer exists ("${draw.bankId}"). Choose another bank or remove the draw.`,
          path,
        );
        return { bankId: draw.bankId, count: draw.count };
      }
      const available = bank.questions.length;
      if (available < draw.count) {
        const has = available === 0 ? 'has no questions yet' : `has only ${available}`;
        report(
          `draws ${questions(draw.count)} from the bank "${bank.title}", which ${has}.`,
          `${path}.count`,
        );
      }
      return {
        bankId: draw.bankId,
        count: draw.count,
        questions: bank.questions.map((question) => ({ ...question, id: allocate(question.id) })),
      };
    });
    return { ...lesson, bankDraws };
  });

  return { course: { ...course, lessons }, issues };
}

// Where a problem sits in reading order: [lesson, bank draw, 1 for a drawn question]; -1 for "not in one".
const PLACE = /^lessons\[(\d+)\](?:\.bankDraws\[(\d+)\](\.questions\[)?)?/;
function place(path: string): [number, number, number] {
  const match = PLACE.exec(path);
  if (!match) return [-1, -1, 0];
  return [
    Number(match[1]),
    match[2] === undefined ? -1 : Number(match[2]),
    match[3] === undefined ? 0 : 1,
  ];
}
const comesAfter = (a: [number, number, number], b: [number, number, number]) =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

/**
 * Everything that stops a course with bank draws from being published, in reading order: `checkPublishable` on
 * the course with its snapshots filled in, plus the bank problems from `resolveBankDraws`. Problems about drawn
 * questions name the bank by its title. `course` is what to publish when `problems` is empty. Studio uses this for
 * live checks and the publish route for the final one.
 */
export function checkPublishableWithBanks(
  course: Course,
  banks: readonly QuestionBank[],
): BankPublishCheck {
  const resolved = resolveBankDraws(course, banks);
  const titles = new Map(banks.map((bank) => [bank.id, bank.title]));
  const problems = checkPublishable(resolved.course).map((problem): PublishProblem => {
    const [lessonIndex, drawIndex] = place(problem.path);
    const lesson = resolved.course.lessons[lessonIndex];
    const bankId = lesson?.kind === 'quiz' ? lesson.bankDraws?.[drawIndex]?.bankId : undefined;
    const title = bankId === undefined ? undefined : titles.get(bankId);
    if (bankId === undefined || title === undefined) return problem;
    return {
      ...problem,
      message: problem.message.replaceAll(`bank "${bankId}"`, () => `bank "${title}"`),
    };
  });
  for (const issue of resolved.issues) {
    const same = problems.findIndex((problem) => problem.path === issue.path);
    if (same >= 0) {
      problems[same] = issue;
      continue;
    }
    const at = place(issue.path);
    const next = problems.findIndex((problem) => comesAfter(place(problem.path), at));
    problems.splice(next < 0 ? problems.length : next, 0, issue);
  }
  return { course: resolved.course, problems };
}

/** The course as drafts keep it: each bank draw is just its bank id and count (snapshots are added at publish). */
export function stripBankSnapshots(course: Course): Course {
  if (
    !course.lessons.some(
      (lesson) =>
        lesson.kind === 'quiz' && lesson.bankDraws?.some((draw) => draw.questions !== undefined),
    )
  ) {
    return course;
  }
  const lessons = course.lessons.map((lesson): Lesson =>
    lesson.kind === 'quiz' && lesson.bankDraws !== undefined
      ? { ...lesson, bankDraws: lesson.bankDraws.map(({ bankId, count }) => ({ bankId, count })) }
      : lesson,
  );
  return { ...course, lessons };
}

const drawCount = (count: number) => Math.min(Math.max(Math.round(count), 1), LIMITS.bankDrawCount);

/**
 * Adds a draw of `count` questions (rounded to 1..50) from a bank to a quiz draft. A quiz has at most 10 draws and
 * one per bank, so otherwise it comes back unchanged.
 */
export function addBankDraw(lesson: QuizLesson, bankId: Id, count = 1): QuizLesson {
  const draws = lesson.bankDraws ?? [];
  if (draws.length >= LIMITS.bankDraws || draws.some((draw) => draw.bankId === bankId))
    return lesson;
  const value = Number.isFinite(count) ? drawCount(count) : 1;
  return { ...lesson, bankDraws: [...draws, { bankId, count: value }] };
}

/** Sets how many questions the draw from a bank takes each attempt, rounded to 1..50. */
export function setBankDrawCount(lesson: QuizLesson, bankId: Id, count: number): QuizLesson {
  const draws = lesson.bankDraws ?? [];
  const index = draws.findIndex((draw) => draw.bankId === bankId);
  const draw = draws[index];
  if (!draw || !Number.isFinite(count) || draw.count === drawCount(count)) return lesson;
  const bankDraws = draws.map((item, i) =>
    i === index ? { ...item, count: drawCount(count) } : item,
  );
  return { ...lesson, bankDraws };
}

/** Removes the draw from a bank. A quiz left without draws has no `bankDraws` at all. */
export function removeBankDraw(lesson: QuizLesson, bankId: Id): QuizLesson {
  const draws = lesson.bankDraws ?? [];
  const bankDraws = draws.filter((draw) => draw.bankId !== bankId);
  if (bankDraws.length === draws.length) return lesson;
  if (bankDraws.length > 0) return { ...lesson, bankDraws };
  const next = { ...lesson };
  delete next.bankDraws;
  return next;
}
