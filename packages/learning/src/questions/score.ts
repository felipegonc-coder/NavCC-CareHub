import type {
  DragMatchingQuestion,
  FillBlankQuestion,
  FillPart,
  HotspotQuestion,
  HotspotSpot,
  Id,
  MatchingQuestion,
  MultipleChoiceQuestion,
  OrderingQuestion,
  Question,
  QuestionResponse,
  RichText,
  SingleChoiceQuestion,
  TrueFalseQuestion,
} from '../format/index';
import { firstWithText, ownValue } from './helpers';
import { spotContainsPoint } from './hotspot';
import { normalizeAnswer } from './normalize';
import { isResponseFor, type ResponseFor } from './response';

/** The outcome of scoring one question. */
export type QuestionResult = {
  questionId: Id;
  /** False when the response is missing, malformed or for another question type. */
  answered: boolean;
  /** True only when the whole answer is right. */
  correct: boolean;
  /** All-or-nothing: `max` when correct, otherwise 0. */
  earned: number;
  /** The question's points. */
  max: number;
  /** Partial credit from 0 to 1, for question analysis only (never added to a score). */
  fraction: number;
  /** Feedback for the answer given (see `scoreQuestion`), or null. */
  feedback: RichText | null;
  /**
   * What was chosen, for question analysis; ids that aren't on the question are left out (see
   * `scoreQuestion`).
   */
  picked: Id[];
};

type Grade = {
  correct: boolean;
  fraction: number;
  picked: Id[];
  answerFeedback?: RichText | undefined;
};

type Blank = Extract<FillPart, { kind: 'blank' }>;

/**
 * Scores one answer. Points are all-or-nothing; `fraction` is partial credit for analysis only. A
 * missing, malformed or other-type response is unanswered: `answered: false`, 0 points, no
 * feedback, nothing picked.
 *
 * - single_choice: the picked option is a correct one.
 * - multiple_choice: the picked set equals the correct set; fraction = max(0, (right − wrong picks)
 *   / correct). Ids that aren't options count as wrong picks.
 * - true_false: the value equals the answer.
 * - matching, drag_matching: every pair maps to itself; fraction = right pairs / pairs.
 * - fill_blank: every blank matches one of its answers after `normalizeAnswer`; fraction = right
 *   blanks / blanks. An empty answer never matches.
 * - ordering: the order equals the listed order; fraction = items in the right position / items.
 * - hotspot: the point is inside a correct spot, or the picked spot is correct.
 *
 * Feedback: the picked option's own feedback (single choice), else `feedbackTrue`/`feedbackFalse`
 * for the value given (true/false), else `feedback.correct` or `feedback.incorrect`, else null.
 * Blank rich text is skipped. `picked`: the option id (single) or option ids in option order
 * (multiple); ["true"] or ["false"] (true/false); one entry per pair, in the question's pair order:
 * the chosen pair id, or "" when the pair is unanswered or matched to an unknown id (matching); the
 * item ids in the order given, repeats dropped (ordering); the spot hit or picked, [] for a miss
 * (hotspot); [] for fill-in. Unanswered questions pick [].
 */
export function scoreQuestion(q: Question, r: QuestionResponse | undefined): QuestionResult {
  const grade = gradeResponse(q, r);
  if (grade === null) {
    return {
      questionId: q.id,
      answered: false,
      correct: false,
      earned: 0,
      max: q.points,
      fraction: 0,
      feedback: null,
      picked: [],
    };
  }
  const general = grade.correct ? q.feedback?.correct : q.feedback?.incorrect;
  return {
    questionId: q.id,
    answered: true,
    correct: grade.correct,
    earned: grade.correct ? q.points : 0,
    max: q.points,
    fraction: grade.fraction,
    feedback: firstWithText(grade.answerFeedback, general),
    picked: grade.picked,
  };
}

function gradeResponse(q: Question, r: QuestionResponse | undefined): Grade | null {
  switch (q.type) {
    case 'single_choice':
      return isResponseFor(q, r) ? gradeSingle(q, r) : null;
    case 'multiple_choice':
      return isResponseFor(q, r) ? gradeMultiple(q, r) : null;
    case 'true_false':
      return isResponseFor(q, r) ? gradeTrueFalse(q, r) : null;
    case 'matching':
    case 'drag_matching':
      return isResponseFor(q, r) ? gradeMatching(q, r) : null;
    case 'fill_blank':
      return isResponseFor(q, r) ? gradeFillBlank(q, r) : null;
    case 'ordering':
      return isResponseFor(q, r) ? gradeOrdering(q, r) : null;
    case 'hotspot':
      return isResponseFor(q, r) ? gradeHotspot(q, r) : null;
  }
}

function gradeSingle(q: SingleChoiceQuestion, r: ResponseFor<'single_choice'>): Grade {
  const option = q.options.find((o) => o.id === r.optionId);
  const correct = option?.correct === true;
  return {
    correct,
    fraction: correct ? 1 : 0,
    picked: option ? [option.id] : [],
    answerFeedback: option?.feedback,
  };
}

function gradeMultiple(q: MultipleChoiceQuestion, r: ResponseFor<'multiple_choice'>): Grade {
  const chosen = new Set(r.optionIds);
  const correctIds = new Set(q.options.filter((o) => o.correct).map((o) => o.id));
  let right = 0;
  for (const id of chosen) if (correctIds.has(id)) right++;
  const wrong = chosen.size - right;
  const correct = wrong === 0 && right === correctIds.size;
  const fraction =
    correctIds.size > 0 ? Math.max(0, (right - wrong) / correctIds.size) : correct ? 1 : 0;
  const picked = unique(q.options.filter((o) => chosen.has(o.id)).map((o) => o.id));
  return { correct, fraction, picked };
}

function gradeTrueFalse(q: TrueFalseQuestion, r: ResponseFor<'true_false'>): Grade {
  const correct = r.value === q.answer;
  return {
    correct,
    fraction: correct ? 1 : 0,
    picked: [String(r.value)],
    answerFeedback: r.value ? q.feedbackTrue : q.feedbackFalse,
  };
}

function gradeMatching(
  q: MatchingQuestion | DragMatchingQuestion,
  r: ResponseFor<'matching' | 'drag_matching'>,
): Grade {
  const pairIds = new Set(q.pairs.map((p) => p.id));
  const picked: Id[] = [];
  let right = 0;
  for (const pair of q.pairs) {
    const chosen = ownValue(r.matches, pair.id);
    picked.push(chosen !== undefined && pairIds.has(chosen) ? chosen : '');
    if (chosen === pair.id) right++;
  }
  const correct = right === q.pairs.length;
  return { correct, fraction: ratio(right, q.pairs.length, correct), picked };
}

function gradeFillBlank(q: FillBlankQuestion, r: ResponseFor<'fill_blank'>): Grade {
  const blanks = q.parts.filter((part): part is Blank => part.kind === 'blank');
  let right = 0;
  for (const blank of blanks) {
    const given = ownValue(r.blanks, blank.id);
    if (given !== undefined && blankAccepts(blank, given)) right++;
  }
  const correct = right === blanks.length;
  return { correct, fraction: ratio(right, blanks.length, correct), picked: [] };
}

function blankAccepts(blank: Blank, given: string): boolean {
  const caseSensitive = blank.caseSensitive === true;
  const answer = normalizeAnswer(given, caseSensitive);
  return (
    answer !== '' &&
    blank.answers.some((accepted) => normalizeAnswer(accepted, caseSensitive) === answer)
  );
}

function gradeOrdering(q: OrderingQuestion, r: ResponseFor<'ordering'>): Grade {
  let right = 0;
  q.items.forEach((item, index) => {
    if (r.order[index] === item.id) right++;
  });
  const correct = r.order.length === q.items.length && right === q.items.length;
  const itemIds = new Set(q.items.map((item) => item.id));
  const picked = unique(r.order.filter((id) => itemIds.has(id)));
  return { correct, fraction: ratio(right, q.items.length, correct), picked };
}

function gradeHotspot(q: HotspotQuestion, r: ResponseFor<'hotspot'>): Grade {
  const { pick } = r;
  let spot: HotspotSpot | undefined;
  if (pick.kind === 'spot') {
    spot = q.spots.find((s) => s.id === pick.spotId);
  } else {
    const hits = q.spots.filter((s) => spotContainsPoint(s, pick.x, pick.y));
    spot = hits.find((s) => s.correct) ?? hits[0];
  }
  const correct = spot?.correct === true;
  return { correct, fraction: correct ? 1 : 0, picked: spot ? [spot.id] : [] };
}

/**
 * right / total, or (when there is nothing to get right) 1 for a correct answer and 0 otherwise.
 */
function ratio(right: number, total: number, correct: boolean): number {
  if (total > 0) return right / total;
  return correct ? 1 : 0;
}

function unique(ids: readonly Id[]): Id[] {
  return [...new Set(ids)];
}
