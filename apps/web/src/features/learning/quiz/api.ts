import {
  IdSchema,
  ProgressEventsResponseSchema,
  QuizPaperQuestionSchema,
  type Id,
  type LearnerCourseState,
  type QuestionResponse,
  type RejectedEvent,
} from '@carehub/learning';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { z } from 'zod';
import { api, apiPath } from '../data';
import { progressKey, progressQueue, stampEvent, useSignedInId } from '../player/data';

// The quiz view's calls (docs/learning/api.md). A quiz needs a connection: nothing here is queued
// (decisions 0302 and 0310).

/** POST /courses/:id/quizzes/:lessonId/attempts: the attempt's paper, with no answers (0314). */
export const AttemptPaperSchema = z.object({
  attemptId: IdSchema,
  questions: z.array(QuizPaperQuestionSchema).min(1),
});
export type AttemptPaper = z.infer<typeof AttemptPaperSchema>;

/** What the server made of a sent attempt: the learner's state, and the refusal if there was one. */
export type Submitted = { state: LearnerCourseState; refused: RejectedEvent | null };

/** Starts and sends the quiz attempts of one course. */
export function useQuizAttempts(courseId: Id) {
  const client = useQueryClient();
  const { userId } = useSignedInId();
  return useMemo(
    () => ({
      /** Starts an attempt on the server; an open attempt sends its paper again. */
      start: async (lessonId: Id): Promise<AttemptPaper> =>
        api(
          'POST',
          apiPath('courses', courseId, 'quizzes', lessonId, 'attempts'),
          { at: new Date().toISOString() },
          AttemptPaperSchema,
        ),
      /**
       * Sends the answers at once, after the signed-in person's events still waiting in the
       * player's queue, and puts the state the server sends back, with the attempt's result, where
       * the player reads it. Fails without sending until core has said who is signed in.
       */
      async submit(
        lessonId: Id,
        attemptId: Id,
        responses: Record<Id, QuestionResponse>,
      ): Promise<Submitted> {
        if (userId === undefined) throw new Error('Not signed in yet.');
        const event = stampEvent({
          type: 'quiz_attempt_submitted',
          lessonId,
          attemptId,
          responses,
        });
        await progressQueue(client, userId).flush();
        try {
          const reply = await api(
            'POST',
            apiPath('courses', courseId, 'events'),
            { events: [event] },
            ProgressEventsResponseSchema,
          );
          await client.cancelQueries({ queryKey: progressKey(courseId) });
          client.setQueryData<LearnerCourseState>(progressKey(courseId), reply.state);
          const refused = reply.rejected.find((rejection) => rejection.eventId === event.id);
          return { state: reply.state, refused: refused ?? null };
        } catch (error) {
          // The answers may have arrived before the reply was lost, so read the state again.
          void client.invalidateQueries({ queryKey: progressKey(courseId) });
          throw error;
        }
      },
    }),
    [client, courseId, userId],
  );
}
