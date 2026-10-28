import { presetFor, type QuizLesson } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuizLessonEditor } from './index';

// Fictional content only.
const updatedAt = '2026-10-27T15:00:00.000Z';
const banks = [
  { id: 'billing', title: 'Billing basics', questionCount: 12, updatedAt },
  { id: 'returns', title: 'Returns', questionCount: 3, updatedAt },
];

function replyWith(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async () => ({ ok: status < 300, status, json: async () => body }) as unknown as Response,
    );
}

/** For tests that don't look at banks: the list never arrives. */
const banksPending = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));

function setup(start: Partial<QuizLesson> = {}) {
  const lesson: QuizLesson = {
    id: 'final',
    kind: 'quiz',
    title: 'Final quiz',
    settings: presetFor('standard').quiz,
    questions: [],
    ...start,
  };
  const latest = { lesson };
  function Harness() {
    const [value, setValue] = useState(lesson);
    const onChange = (next: QuizLesson) => {
      latest.lesson = next;
      setValue(next);
    };
    return <QuizLessonEditor lesson={value} onChange={onChange} />;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return latest;
}

const click = (role: string, name: string) => fireEvent.click(screen.getByRole(role, { name }));
const number = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('spinbutton', { name }), { target: { value } });
const addButtons = () =>
  within(screen.getByRole('group', { name: 'Add a question' }))
    .getAllByRole('button')
    .map((button) => button.textContent);

afterEach(() => vi.restoreAllMocks());

describe('QuizLessonEditor', () => {
  it('changes the pass mark, tries and shuffling', () => {
    banksPending();
    const latest = setup();
    number('Pass mark (%)', '90');
    click('switch', 'Unlimited tries');
    expect(latest.lesson.settings.maxAttempts).toBe(3);
    number('Number of tries', '5');
    click('switch', 'Shuffle the questions');
    expect(latest.lesson.settings).toMatchObject({
      passMark: 90,
      maxAttempts: 5,
      shuffleQuestions: true,
    });
    click('switch', 'Unlimited tries');
    expect(latest.lesson.settings.maxAttempts).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Number of tries' })).toBeNull();
  });

  it('adds, copies, moves and deletes questions', () => {
    banksPending();
    const latest = setup();
    expect(screen.getByText('No questions yet. Add one below.')).toBeInTheDocument();
    expect(addButtons()).not.toContain('Click the right spot');
    click('button', 'True or false');
    click('button', 'Single answer');
    const [first, second] = latest.lesson.questions;
    expect([first?.type, second?.type]).toEqual(['true_false', 'single_choice']);
    click('button', 'Copy question 1');
    expect(latest.lesson.questions.map((q) => q.type)).toEqual([
      'true_false',
      'true_false',
      'single_choice',
    ]);
    expect(new Set(latest.lesson.questions.map((q) => q.id)).size).toBe(3);
    click('button', 'Move question 3 up');
    expect(latest.lesson.questions.map((q) => q.type)).toEqual([
      'true_false',
      'single_choice',
      'true_false',
    ]);
    click('button', 'Remove question 1');
    expect(latest.lesson.questions.map((q) => q.id)).toEqual([
      second?.id,
      latest.lesson.questions[1]?.id,
    ]);
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Question 1',
      'Question 2',
    ]);
  });

  it('turns into a survey with single and multiple answer questions only', () => {
    banksPending();
    const latest = setup();
    click('switch', 'This is a survey');
    expect(latest.lesson.settings.mode).toBe('survey');
    expect(screen.queryByRole('spinbutton', { name: 'Pass mark (%)' })).toBeNull();
    expect(addButtons()).toEqual(['Single answer', 'Multiple answer']);
    click('switch', 'This is a survey');
    expect('mode' in latest.lesson.settings).toBe(false);
  });

  it('draws some of its own questions each try', () => {
    banksPending();
    const latest = setup();
    click('button', 'True or false');
    click('button', 'True or false');
    click('switch', 'Use a question pool');
    expect(latest.lesson.settings.poolSize).toBe(2);
    number('Questions per try', '1');
    expect(latest.lesson.settings.poolSize).toBe(1);
    number('Questions per try', '');
    expect(latest.lesson.settings.poolSize).toBe(1);
    click('switch', 'Use a question pool');
    expect('poolSize' in latest.lesson.settings).toBe(false);
  });

  it('adds questions from banks and sets how many each try takes', async () => {
    const fetch = replyWith(banks);
    const latest = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Add questions from a bank' }));
    expect(fetch.mock.calls[0]?.[0]).toBe('/api/learning/studio/banks');
    click('button', 'Add Returns');
    expect(latest.lesson.bankDraws).toEqual([{ bankId: 'returns', count: 3 }]);
    expect(screen.getByText('The bank has 3 questions.')).toBeInTheDocument();
    number('Questions per try from Returns', '2');
    expect(latest.lesson.bankDraws).toEqual([{ bankId: 'returns', count: 2 }]);
    click('button', 'Add questions from a bank');
    expect(screen.queryByRole('button', { name: 'Add Returns' })).toBeNull();
    click('button', 'Add Billing basics');
    expect(latest.lesson.bankDraws?.map((draw) => draw.count)).toEqual([2, 5]);
    click('button', 'Stop using Returns');
    expect(latest.lesson.bankDraws).toEqual([{ bankId: 'billing', count: 5 }]);
  });

  it('names a draw whose bank is gone', async () => {
    replyWith(banks);
    setup({ bankDraws: [{ bankId: 'old-bank', count: 2 }] });
    expect(
      await screen.findByText("This bank doesn't exist any more. Remove it or pick another."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('spinbutton', { name: 'Questions per try from bank "old-bank"' }),
    ).toBeInTheDocument();
  });

  it('offers to try again when the banks fail to load', async () => {
    replyWith(
      { error: { code: 'server_error', message: 'Something went wrong on our side.' } },
      500,
    );
    setup();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't load the question banks.");
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
