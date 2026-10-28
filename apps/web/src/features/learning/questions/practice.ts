import {
  paperResponses,
  planAttempt,
  quizPaper,
  scoreQuestion,
  type Question,
  type QuestionResponse,
  type QuestionResult,
  type QuizLesson,
  type QuizPaperQuestion,
} from '@carehub/learning';

/** A practice question on a paper, like a quiz question, with a way to check answers given on it. */
export type Practice = {
  /** The question without its answers; matching lists and ordering items shuffled by the seed. */
  paper: QuizPaperQuestion;
  /** Scores an answer given on `paper` against the question. */
  check(response: QuestionResponse | undefined): QuestionResult;
};

/**
 * Puts a practice question (a knowledge check) on a paper through a one-question quiz, so practice
 * uses the same answer inputs as quizzes. Choice options keep their order. Use a new `seed` for
 * each try.
 */
export function practice(question: Question, seed: number): Practice {
  const quiz: QuizLesson = {
    id: question.id,
    kind: 'quiz',
    title: 'Practice',
    settings: {
      passMark: 0,
      maxAttempts: null,
      shuffleQuestions: false,
      shuffleOptions: false,
      revealAnswers: 'never',
    },
    questions: [question],
  };
  const plan = planAttempt(quiz, seed, 'practice');
  const [paper] = quizPaper(quiz, plan);
  if (!paper) throw new Error('A one-question quiz always has a paper.');
  return {
    paper,
    check: (response) =>
      scoreQuestion(
        question,
        response && paperResponses(quiz, plan, { [question.id]: response })[question.id],
      ),
  };
}

/** A seed for a new try. */
export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}
