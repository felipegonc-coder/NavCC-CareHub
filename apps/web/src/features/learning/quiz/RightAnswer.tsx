import type { Id, QuestionResponse, QuizPaperQuestion } from '@carehub/learning';
import type { ReactNode } from 'react';
import { answerFor, own } from '../questions/answer';

type RightAnswerProps = { question: QuizPaperQuestion; answer: QuestionResponse };

/**
 * The right answer to a paper question, in words, for after an attempt while the quiz shows right
 * answers (decision 0316). `answer` is in the paper's ids; nothing shows when it doesn't fit.
 */
export function RightAnswer({ question, answer }: RightAnswerProps) {
  const lines = answerLines(question, answer);
  if (lines.length === 0) return null;
  if (lines.length === 1) {
    return (
      <p className="text-body text-fg">
        <span className="font-medium">Right answer:</span> {lines[0]}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 text-body text-fg">
      <p className="font-medium">Right answer:</p>
      <ul className="flex flex-col gap-1">
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

const textOf = (list: readonly { id: Id; text: string }[], id: Id | undefined) =>
  list.find((entry) => entry.id === id)?.text;
const known = (texts: readonly (string | undefined)[]) =>
  texts.filter((text): text is string => text !== undefined);

/** One line per right option, pair or item; fill-in shows the sentence with its blanks filled. */
function answerLines(question: QuizPaperQuestion, answer: QuestionResponse): ReactNode[] {
  switch (question.type) {
    case 'single_choice':
      return known([textOf(question.options, answerFor(question.type, answer)?.optionId)]);
    case 'multiple_choice': {
      const ids = answerFor(question.type, answer)?.optionIds ?? [];
      return question.options.filter((option) => ids.includes(option.id)).map((o) => o.text);
    }
    case 'true_false': {
      const right = answerFor(question.type, answer);
      return right ? [right.value ? 'True' : 'False'] : [];
    }
    case 'matching':
    case 'drag_matching': {
      const matches = answerFor(question.type, answer)?.matches ?? {};
      return question.prompts.flatMap((prompt) => {
        const match = textOf(question.matches, own(matches, prompt.id));
        return match === undefined ? [] : [`${prompt.text}: ${match}`];
      });
    }
    case 'fill_blank': {
      const right = answerFor(question.type, answer);
      if (!right) return [];
      return [
        question.parts.map((part, index) =>
          part.kind === 'text' ? (
            part.text
          ) : (
            <strong key={index}>{own(right.blanks, part.id) ?? '…'}</strong>
          ),
        ),
      ];
    }
    case 'ordering': {
      const order = answerFor(question.type, answer)?.order ?? [];
      const texts = known(order.map((id) => textOf(question.items, id)));
      return texts.map((text, index) => `${index + 1}. ${text}`);
    }
    case 'hotspot': {
      const pick = answerFor(question.type, answer)?.pick;
      const spotId = pick?.kind === 'spot' ? pick.spotId : undefined;
      return known([question.spots.find((spot) => spot.id === spotId)?.label]);
    }
  }
}
