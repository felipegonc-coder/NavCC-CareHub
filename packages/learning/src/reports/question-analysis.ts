import type { Id, Question, QuestionType, QuizSettings, RichText } from '../format/index';

/** What question analysis reads from a scored attempt. Quiz attempt results fit as they are. */
export type AnalysedAttempt = {
  results: readonly {
    questionId: Id;
    correct: boolean;
    picked: readonly Id[];
    answered?: boolean;
  }[];
};

/**
 * A quiz lesson's questions, plus the published snapshots of the banks it draws from. A
 * `QuizLesson` fits.
 */
export type AnalysedQuiz = {
  settings?: Pick<QuizSettings, 'mode'> | undefined;
  questions: readonly Question[];
  bankDraws?: readonly { questions?: readonly Question[] | undefined }[] | undefined;
};

/**
 * A wrong answer and how often it was picked. For matching, `id` is "<pair id>><chosen pair id>".
 */
export type WrongPick = { id: string; text: string; count: number };

/** How one question went. */
export type QuestionAnalysisEntry = {
  questionId: Id;
  type: QuestionType;
  prompt: string;
  answered: number;
  correct: number;
  /** Correct out of answered, whole percent; null if nobody answered. */
  percentCorrect: number | null;
  /** Most picked first. */
  wrongPicks: WrongPick[];
};

type FoundPick = { id: string; text: string; order: number };
type Tally = {
  answered: number;
  correct: number;
  picks: Map<string, FoundPick & { count: number }>;
};

function textOf(rich: RichText): string {
  return rich.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
}

/**
 * The wrong answers in one result's `picked` ids, in question order: choice options and hotspot
 * spots that aren't correct, the wrong true/false value ("true" or "false"), and for matching each
 * prompt given another pair's match (`picked[i]` is the pair chosen for `pairs[i]`).
 * Fill-in-the-blank and ordering have nothing to pick.
 */
function wrongPicksIn(question: Question, picked: readonly Id[]): FoundPick[] {
  switch (question.type) {
    case 'single_choice':
    case 'multiple_choice':
      return question.options.flatMap((option, order) =>
        !option.correct && picked.includes(option.id)
          ? [{ id: option.id, text: option.text, order }]
          : [],
      );
    case 'hotspot':
      return question.spots.flatMap((spot, order) =>
        !spot.correct && picked.includes(spot.id) ? [{ id: spot.id, text: spot.label, order }] : [],
      );
    case 'true_false': {
      const wrong = String(!question.answer);
      return picked.includes(wrong)
        ? [{ id: wrong, text: question.answer ? 'False' : 'True', order: 0 }]
        : [];
    }
    case 'matching':
    case 'drag_matching': {
      const { pairs } = question;
      return pairs.flatMap((pair, index) => {
        const chosen = pairs.findIndex((other) => other.id === picked[index]);
        const match = pairs[chosen];
        if (match === undefined || match.id === pair.id) return [];
        return [
          {
            id: `${pair.id}>${match.id}`,
            text: `${pair.prompt} → ${match.match}`,
            order: index * pairs.length + chosen,
          },
        ];
      });
    }
    default:
      return [];
  }
}

/**
 * Question analysis for a graded quiz (for knowledge checks, pass `{ questions }`). Covers the
 * lesson's own questions and the bank questions it draws, each id once. Per question: how many
 * answered, how many were correct, the percent correct and the wrong answers picked, most picked
 * first, labelled with the option, match or spot text. Most-missed questions come first (lowest
 * percent correct, then most answered, then quiz order); questions nobody answered come last.
 * Unanswered results and results for unknown questions are ignored. A survey-mode quiz
 * (`settings.mode: "survey"`) has no right answers, so it gets no analysis (an empty list): its
 * answers belong in the survey results.
 */
export function questionAnalysis(
  quiz: AnalysedQuiz,
  attempts: readonly AnalysedAttempt[],
): QuestionAnalysisEntry[] {
  if (quiz.settings?.mode === 'survey') return [];
  const questions = new Map<Id, Question>();
  for (const question of [
    ...quiz.questions,
    ...(quiz.bankDraws ?? []).flatMap((draw) => draw.questions ?? []),
  ]) {
    if (!questions.has(question.id)) questions.set(question.id, question);
  }
  const tallies = new Map<Id, Tally>(
    [...questions.keys()].map((id) => [id, { answered: 0, correct: 0, picks: new Map() }]),
  );
  for (const result of attempts.flatMap((attempt) => attempt.results)) {
    const question = questions.get(result.questionId);
    const tally = tallies.get(result.questionId);
    if (!question || !tally || result.answered === false) continue;
    tally.answered += 1;
    if (result.correct) {
      tally.correct += 1;
      continue;
    }
    for (const pick of wrongPicksIn(question, result.picked)) {
      const counted = tally.picks.get(pick.id);
      if (counted) counted.count += 1;
      else tally.picks.set(pick.id, { ...pick, count: 1 });
    }
  }

  const entries = [...questions.values()].map((question, index) => {
    const { answered, correct, picks } = tallies.get(question.id) ?? {
      answered: 0,
      correct: 0,
      picks: new Map(),
    };
    const wrongPicks = [...picks.values()]
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .map(({ id, text, count }) => ({ id, text, count }));
    const percentCorrect = answered === 0 ? null : Math.round((correct * 100) / answered);
    const entry: QuestionAnalysisEntry = {
      questionId: question.id,
      type: question.type,
      prompt: textOf(question.prompt),
      answered,
      correct,
      percentCorrect,
      wrongPicks,
    };
    return { entry, index };
  });
  return entries
    .sort((a, b) => {
      const [x, y] = [a.entry.percentCorrect, b.entry.percentCorrect];
      if (x === null || y === null) return x === y ? a.index - b.index : x === null ? 1 : -1;
      return x - y || b.entry.answered - a.entry.answered || a.index - b.index;
    })
    .map(({ entry }) => entry);
}
