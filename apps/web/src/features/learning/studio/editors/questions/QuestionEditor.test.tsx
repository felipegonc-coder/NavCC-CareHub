import { newQuestion, richText, type Question, type QuestionType } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { QuestionEditor, type QuestionEditorProps } from './QuestionEditor';

// Fictional content only.
const picture = {
  media: { kind: 'url', url: 'https://example.test/help-desk.png' },
  alt: 'The help desk screen',
} as const;

function setup(
  type: QuestionType,
  props: Partial<QuestionEditorProps> = {},
  edit: (question: Question) => Question = (question) => question,
) {
  let n = 0;
  const start = edit({
    ...newQuestion(type, () => `id${++n}`, { image: picture }),
    prompt: richText('Who handles refunds?'),
  });
  const latest = { question: start };
  function Harness() {
    const [question, setQuestion] = useState(start);
    const onChange = (next: Question) => {
      latest.question = next;
      setQuestion(next);
    };
    return <QuestionEditor {...props} question={question} onChange={onChange} />;
  }
  render(<Harness />);
  return latest;
}

const type = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
const click = (role: string, name: string) => fireEvent.click(screen.getByRole(role, { name }));
const choices = (question: Question) =>
  'options' in question ? question.options.map((o) => [o.text, o.correct]) : [];

describe('QuestionEditor', () => {
  it('edits single choice answers, with one right answer', () => {
    const latest = setup('single_choice');
    expect(screen.getByText('Single answer')).toBeInTheDocument();
    expect(screen.getByText('Has no correct answer.')).toBeInTheDocument();
    type('Answer 1', 'Billing');
    type('Answer 2', 'Repairs');
    click('checkbox', 'Right answer (answer 1)');
    click('checkbox', 'Right answer (answer 2)');
    expect(choices(latest.question)).toEqual([
      ['Billing', false],
      ['Repairs', true],
    ]);
    expect(screen.queryByText('Before this can be published:')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove answer 1' })).toBeDisabled();
    click('button', 'Add answer');
    expect(choices(latest.question)).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Remove answer 1' })).toBeEnabled();
  });

  it('lets multiple choice have several right answers, and moves answers', () => {
    const latest = setup('multiple_choice', {}, (question) =>
      question.type === 'multiple_choice'
        ? {
            ...question,
            options: question.options.map((o, i) => ({ ...o, text: `Team ${i + 1}` })),
          }
        : question,
    );
    click('checkbox', 'Right answer (answer 1)');
    click('checkbox', 'Right answer (answer 2)');
    click('button', 'Move answer 1 down');
    expect(choices(latest.question)).toEqual([
      ['Team 2', true],
      ['Team 1', true],
    ]);
    expect(screen.getByRole('button', { name: 'Move answer 1 up' })).toBeDisabled();
  });

  it('hides right answers, points and feedback in a survey', () => {
    setup('single_choice', { survey: true });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Points' })).toBeNull();
    expect(screen.queryByText('Feedback when right')).toBeNull();
    expect(screen.getByText('Option 1 needs text.')).toBeInTheDocument();
    expect(screen.queryByText('Has no correct answer.')).toBeNull();
  });

  it('edits points, true or false, and shows every feedback field', () => {
    const latest = setup('true_false');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Points' }), {
      target: { value: '5' },
    });
    click('checkbox', 'The statement is true');
    expect(latest.question).toMatchObject({ points: 5, answer: false });
    for (const label of [
      'Feedback when right',
      'Feedback when wrong',
      'Feedback after answering true',
      'Feedback after answering false',
    ])
      expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('can leave points out', () => {
    setup('true_false', { showPoints: false });
    expect(screen.queryByRole('spinbutton', { name: 'Points' })).toBeNull();
  });

  it('edits matching pairs and put-in-order steps', () => {
    const pairs = setup('matching');
    type('Item 1', 'Refund');
    type('Match for item 1', 'Billing');
    click('button', 'Add pair');
    expect(pairs.question.type === 'matching' && pairs.question.pairs).toMatchObject([
      { prompt: 'Refund', match: 'Billing' },
      { prompt: '', match: '' },
      { prompt: '', match: '' },
    ]);
  });

  it('keeps put-in-order steps in the order they are listed', () => {
    const steps = setup('ordering');
    type('Step 1', 'Greet the caller');
    type('Step 2', 'Check their account');
    click('button', 'Move step 2 up');
    expect(steps.question.type === 'ordering' && steps.question.items.map((i) => i.text)).toEqual([
      'Check their account',
      'Greet the caller',
    ]);
  });

  it('builds a fill-in-the-blank sentence from text and blanks', () => {
    const latest = setup('fill_blank');
    type('Text 1', 'Send refunds to ');
    type('Blank 1: accepted answers', 'Billing\nthe billing team');
    click('checkbox', 'Blank 1: capitals must match');
    expect(screen.getByText('Preview: Send refunds to _____')).toBeInTheDocument();
    click('button', 'Add text');
    expect(latest.question.type === 'fill_blank' && latest.question.parts).toEqual([
      { kind: 'text', text: 'Send refunds to ' },
      { kind: 'blank', id: 'id2', answers: ['Billing', 'the billing team'], caseSensitive: true },
      { kind: 'text', text: '' },
    ]);
    expect(screen.getByRole('button', { name: 'Remove blank 1' })).toBeDisabled();
  });

  it('edits the areas of a click-the-right-spot question', () => {
    const latest = setup('hotspot');
    expect(screen.getByText('Has no correct area.')).toBeInTheDocument();
    click('button', 'Add area');
    type('Area 1 name', 'Refund button');
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Area 1: Width (%)' }), {
      target: { value: '150' },
    });
    type('Picture description', 'The refunds screen');
    expect(latest.question).toMatchObject({
      image: { alt: 'The refunds screen' },
      spots: [{ label: 'Refund button', correct: true, x: 0, width: 100, shape: 'rect' }],
    });
    click('checkbox', 'Area 1 is an oval');
    expect(latest.question).toMatchObject({ spots: [{ shape: 'ellipse' }] });
    expect(screen.queryByText('Before this can be published:')).toBeNull();
  });
});
