import {
  paperAnswerKey,
  planAttempt,
  quizPaper,
  richText,
  type QuestionResponse,
  type QuizLesson,
  type QuizPaperQuestion,
} from '@carehub/learning';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RightAnswer } from './RightAnswer';

// Fictional content only.
const quiz: QuizLesson = {
  id: 'quiz-billing',
  kind: 'quiz',
  title: 'Pinecrest Wireless billing check',
  settings: {
    passMark: 80,
    maxAttempts: null,
    shuffleQuestions: false,
    shuffleOptions: false,
    revealAnswers: 'after_each_attempt',
  },
  questions: [
    {
      id: 'q-multi',
      type: 'multiple_choice',
      prompt: richText('Which can a caller change on their own?'),
      points: 1,
      options: [
        { id: 'pin', text: 'Their PIN', correct: true },
        { id: 'owner', text: 'The account owner', correct: false },
        { id: 'email', text: 'Their email address', correct: true },
      ],
    },
    {
      id: 'q-match',
      type: 'drag_matching',
      prompt: richText('Match each term to its meaning.'),
      points: 1,
      pairs: [
        { id: 'p-apr', prompt: 'APR', match: 'Yearly interest' },
        { id: 'p-dd', prompt: 'Direct debit', match: 'Automatic payment' },
        { id: 'p-credit', prompt: 'Credit', match: 'Money owed to the member' },
      ],
    },
    {
      id: 'q-fill',
      type: 'fill_blank',
      prompt: richText('Fill in the opening time.'),
      points: 1,
      parts: [
        { kind: 'text', text: 'Support opens at ' },
        { kind: 'blank', id: 'opens', answers: ['8 am', '8:00'] },
        { kind: 'text', text: ' on weekdays.' },
      ],
    },
    {
      id: 'q-order',
      type: 'ordering',
      prompt: richText('Put the call steps in order.'),
      points: 1,
      items: [
        { id: 'step-1', text: 'Greet the caller' },
        { id: 'step-2', text: 'Check their identity' },
        { id: 'step-3', text: 'Close the call' },
      ],
    },
    {
      id: 'q-spot',
      type: 'hotspot',
      prompt: richText('Click the total due.'),
      image: {
        media: { kind: 'url', url: 'https://example.com/fictional-bill.png' },
        alt: 'A fictional phone bill',
      },
      points: 1,
      spots: [
        {
          id: 'date',
          shape: 'rect',
          x: 10,
          y: 8,
          width: 20,
          height: 6,
          correct: false,
          label: 'Date',
        },
        {
          id: 'total',
          shape: 'rect',
          x: 60,
          y: 70,
          width: 30,
          height: 10,
          correct: true,
          label: 'Total due',
        },
      ],
    },
  ],
};

/** What RightAnswer says: one entry per listed line, else its one line. */
function words(question: QuizPaperQuestion, answer: QuestionResponse | undefined) {
  if (!answer) return null;
  const { container, unmount } = render(<RightAnswer question={question} answer={answer} />);
  const items = [...container.querySelectorAll('li')].map((item) => item.textContent);
  const said = items.length > 0 ? items : [container.textContent];
  unmount();
  return said;
}

describe('RightAnswer', () => {
  it('words the right answer to each type, however the paper is shuffled', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const plan = planAttempt(quiz, seed, `att-${seed}`);
      const key = paperAnswerKey(quiz, plan);
      const said = Object.fromEntries(
        quizPaper(quiz, plan).map((question) => [question.id, words(question, key[question.id])]),
      );
      expect(said).toEqual({
        'q-multi': ['Their PIN', 'Their email address'],
        'q-match': [
          'APR: Yearly interest',
          'Direct debit: Automatic payment',
          'Credit: Money owed to the member',
        ],
        'q-fill': ['Right answer: Support opens at 8 am on weekdays.'],
        'q-order': ['1. Greet the caller', '2. Check their identity', '3. Close the call'],
        'q-spot': ['Right answer: Total due'],
      });
    }
  });

  it('marks the filled-in words, and shows nothing for an answer of another type', () => {
    const plan = planAttempt(quiz, 1, 'att');
    const [multi, match, fill] = quizPaper(quiz, plan);
    const fillAnswer = paperAnswerKey(quiz, plan)['q-fill'];
    if (!multi || !match || !fill || !fillAnswer) throw new Error('The paper has every question.');
    const filled = render(<RightAnswer question={fill} answer={fillAnswer} />);
    expect(filled.container.querySelector('strong')?.textContent).toBe('8 am');
    filled.unmount();
    const other = render(
      <RightAnswer
        question={match}
        answer={{ type: 'matching', matches: { 'p-apr': 'match-1' } }}
      />,
    );
    expect(other.container.textContent).toBe('');
    other.unmount();
    const wrongType = render(
      <RightAnswer question={multi} answer={{ type: 'true_false', value: true }} />,
    );
    expect(wrongType.container.textContent).toBe('');
  });
});
