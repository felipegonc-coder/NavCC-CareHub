import {
  blockHelpText,
  cutHelpSelection,
  HELP_QUESTION_TYPES,
  helpAnswerText,
  HelpQuestionDraftsSchema,
  helpQuestions,
  HelpQuestionsRequestSchema,
  helpQuestionsPrompt,
  HelpSummaryRequestSchema,
  HelpSummarySchema,
  helpSummaryPrompt,
  HelpWriteRequestSchema,
  helpWritePrompt,
  lessonHelpText,
  type Course,
  type HelpQuestionsReply,
  type HelpQuestionType,
  type HelpSummary,
  type HelpWriteReply,
  type Lesson,
} from '@carehub/learning';
import type { FastifyPluginAsync } from 'fastify';
import { errorBody, HttpError } from '../../../core/errors';
import type { Db } from '../../../db';
import {
  askClaude,
  askClaudeJson,
  claudeErrorReason,
  claudeHttpError,
  isClaudeFeatureOn,
} from '../../claude/index';
import { requirePermission, viewerOf, type Viewer } from '../auth';
import { getStudioCourse } from '../courses/service';
import { errorReply, httpError, parseInput } from '../errors';

// Learning help (decision 0315), under /api/learning/help: writing help, summaries with key points, and quiz
// questions. Studio only (learning.build); the shared Claude client checks everything else, claude.use and the
// learning_help switch included. The server reads the saved draft itself, by id, and sends Claude course
// content only. Nothing here saves: Studio adds an answer to the draft when the author accepts it.

const FEATURE = 'learning_help';
const STALE = 'This course changed since you opened it. Reload, then try again.';

/** The saved draft, in the person's workspace, if it is still the revision Studio has open. */
async function savedDraft(db: Db, viewer: Viewer, courseId: string, revision: number) {
  const draft = await getStudioCourse(db, viewer, courseId);
  if (draft.revision !== revision) throw httpError(409, STALE);
  return draft.course;
}

/**
 * Asks through the shared client. Its refusals become its HTTP errors, and an answer that comes back after
 * the switch went off is dropped.
 */
async function ask<T>(db: Db, viewer: Viewer, send: () => Promise<T>): Promise<T> {
  let answer: T;
  try {
    answer = await send();
  } catch (error) {
    const reason = claudeErrorReason(error);
    if (reason) throw claudeHttpError(reason);
    throw error;
  }
  if (!(await isClaudeFeatureOn(db, viewer.workspaceId, FEATURE))) {
    throw claudeHttpError('switched_off');
  }
  return answer;
}

/** Text from a lesson, with a title that places it in the course. */
const lessonDocument = (course: Course, lesson: Lesson, index: number, text: string) => ({
  title: `${course.title}, lesson ${index + 1}: ${lesson.title}`,
  text,
});

const helpRoutes: FastifyPluginAsync = async (app) => {
  const build = { preHandler: requirePermission('learning.build') };

  // Like Learning's handler, except that core's errors keep their details, so Claude's refusals carry
  // `details: { reason }`. Logs hold only the status and the error's type.
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.details));
    }
    const { status, body } = errorReply(error);
    if (status >= 500) {
      const type = error instanceof Error ? error.name : typeof error;
      request.log.error({ status, type }, 'Learning help request failed');
    }
    return reply.code(status).send(body);
  });

  app.post('/write', build, async (request): Promise<HelpWriteReply> => {
    const input = parseInput(HelpWriteRequestSchema, request.body);
    const viewer = viewerOf(request);
    const course = await savedDraft(app.db, viewer, input.courseId, input.revision);
    const index = course.lessons.findIndex((lesson) => lesson.id === input.lessonId);
    const lesson = course.lessons[index];
    const block =
      lesson?.kind === 'content' ? lesson.blocks.find((b) => b.id === input.blockId) : undefined;
    if (!lesson || !block) throw httpError(404);

    const text = blockHelpText(block);
    const selection = input.selection ? cutHelpSelection(text, input.selection) : undefined;
    if (selection === null) throw httpError(400, 'Select text in this block, then try again.');
    // Continue writing goes on from the end of the selection, so Claude reads the text up to there.
    const continuing = input.action === 'continue';
    const context = continuing && input.selection ? text.slice(0, input.selection.end) : text;
    const selected = continuing ? undefined : selection;
    if (!(selected ?? context).trim()) throw httpError(400, "There's no text here to work on yet.");

    const { text: answer } = await ask(app.db, viewer, () =>
      askClaude(app.db, {
        workspaceId: viewer.workspaceId,
        userId: viewer.userId,
        feature: FEATURE,
        ...helpWritePrompt(input.action, input.tone, selected !== undefined),
        documents: [lessonDocument(course, lesson, index, context)],
        ...(selected !== undefined ? { selection: selected } : {}),
      }),
    );
    const cleaned = helpAnswerText(answer);
    if (!cleaned) throw claudeHttpError('bad_output');
    return { text: cleaned };
  });

  app.post('/summary', build, async (request): Promise<HelpSummary> => {
    const input = parseInput(HelpSummaryRequestSchema, request.body);
    const viewer = viewerOf(request);
    const course = await savedDraft(app.db, viewer, input.courseId, input.revision);
    const { lessonId } = input;
    const chosen = course.lessons.flatMap((lesson, index) =>
      lessonId === undefined || lesson.id === lessonId
        ? [lessonDocument(course, lesson, index, lessonHelpText(lesson))]
        : [],
    );
    if (lessonId !== undefined && chosen.length === 0) throw httpError(404);
    const documents = chosen.filter((document) => document.text.trim() !== '');
    if (documents.length === 0) throw httpError(400, "There's no text here to summarize yet.");

    const { data } = await ask(app.db, viewer, () =>
      askClaudeJson(app.db, {
        workspaceId: viewer.workspaceId,
        userId: viewer.userId,
        feature: FEATURE,
        ...helpSummaryPrompt(lessonId === undefined ? 'course' : 'lesson'),
        documents,
        schema: HelpSummarySchema,
      }),
    );
    return data;
  });

  app.post('/questions', build, async (request): Promise<HelpQuestionsReply> => {
    const input = parseInput(HelpQuestionsRequestSchema, request.body);
    const viewer = viewerOf(request);
    const course = await savedDraft(app.db, viewer, input.courseId, input.revision);
    const index = course.lessons.findIndex((lesson) => lesson.id === input.lessonId);
    const lesson = course.lessons[index];
    if (!lesson) throw httpError(404);
    const text = lessonHelpText(lesson);
    if (!text.trim()) throw httpError(400, "There's no text here to write questions about yet.");
    const types: readonly HelpQuestionType[] = input.types ?? HELP_QUESTION_TYPES;

    const { data } = await ask(app.db, viewer, () =>
      askClaudeJson(app.db, {
        workspaceId: viewer.workspaceId,
        userId: viewer.userId,
        feature: FEATURE,
        ...helpQuestionsPrompt(input.count, types),
        documents: [lessonDocument(course, lesson, index, text)],
        schema: HelpQuestionDraftsSchema,
      }),
    );
    // Claude's questions go through the course checks; only the ones that pass, of the types asked for, go back.
    const asked = data.questions.filter((draft) => types.includes(draft.type));
    const questions = helpQuestions(course, asked.slice(0, input.count));
    if (questions.length === 0) throw claudeHttpError('bad_output');
    return { questions };
  });
};

export default helpRoutes;
