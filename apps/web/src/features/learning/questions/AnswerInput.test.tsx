import { richText, type QuestionResponse, type QuizPaperQuestion } from '@carehub/learning';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AnswerInput } from './AnswerInput';

const base = { prompt: richText('Pick one'), points: 1 };

function Harness(props: {
  question: QuizPaperQuestion;
  onChange(response: QuestionResponse): void;
  disabled: boolean;
}) {
  const [response, setResponse] = useState<QuestionResponse>();
  return (
    <>
      <p id="prompt">The question</p>
      <AnswerInput
        question={props.question}
        response={response}
        disabled={props.disabled}
        labelledBy="prompt"
        onChange={(next) => {
          setResponse(next);
          props.onChange(next);
        }}
      />
    </>
  );
}

function renderInput(question: QuizPaperQuestion, disabled = false) {
  const onChange = vi.fn();
  render(<Harness question={question} onChange={onChange} disabled={disabled} />);
  return onChange;
}

const single: QuizPaperQuestion = {
  ...base,
  id: 'q1',
  type: 'single_choice',
  options: [
    { id: 'o1', text: 'Hang up' },
    { id: 'o2', text: 'Greet the caller' },
  ],
};

describe('AnswerInput', () => {
  it('picks one option, named by the prompt', () => {
    const onChange = renderInput(single);
    const group = screen.getByRole('radiogroup', { name: 'The question' });
    fireEvent.click(within(group).getByRole('radio', { name: 'Greet the caller' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'single_choice', optionId: 'o2' });
    expect(screen.getByRole('radio', { name: 'Greet the caller' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Hang up' })).not.toBeChecked();
  });

  it('picks several options, in option order', () => {
    const onChange = renderInput({
      ...base,
      id: 'q2',
      type: 'multiple_choice',
      options: [
        { id: 'a', text: 'Name' },
        { id: 'b', text: 'Team' },
        { id: 'c', text: 'Weather' },
      ],
    });
    expect(screen.getByText('Choose all that apply.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Team' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Name' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'multiple_choice', optionIds: ['a', 'b'] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Team' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'multiple_choice', optionIds: ['a'] });
  });

  it('answers true or false', () => {
    const onChange = renderInput({ ...base, id: 'q3', type: 'true_false' });
    fireEvent.click(screen.getByRole('radio', { name: 'False' }));
    expect(onChange).toHaveBeenLastCalledWith({ type: 'true_false', value: false });
  });

  it('matches each item from a list', () => {
    const onChange = renderInput({
      ...base,
      id: 'q4',
      type: 'matching',
      prompts: [
        { id: 'p1', text: 'Red light' },
        { id: 'p2', text: 'Green light' },
      ],
      matches: [
        { id: 'match-1', text: 'Go' },
        { id: 'match-2', text: 'Stop' },
      ],
    });
    const red = screen.getByRole('combobox', { name: 'Red light' });
    fireEvent.change(red, { target: { value: 'match-2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Green light' }), {
      target: { value: 'match-1' },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'matching',
      matches: { p1: 'match-2', p2: 'match-1' },
    });
    fireEvent.change(red, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'matching', matches: { p2: 'match-1' } });
  });

  it('places cards next to items and takes them back', () => {
    const onChange = renderInput({
      ...base,
      id: 'q5',
      type: 'drag_matching',
      prompts: [
        { id: 'p1', text: 'Red light' },
        { id: 'p2', text: 'Green light' },
      ],
      matches: [
        { id: 'match-1', text: 'Go' },
        { id: 'match-2', text: 'Stop' },
      ],
    });
    const red = () => screen.getByRole('button', { name: /^Red light:/ });
    expect(red()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(screen.getByRole('button', { name: 'Stop' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(red());
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'drag_matching',
      matches: { p1: 'match-2' },
    });
    expect(red()).toHaveAccessibleName('Red light: Stop');
    const cards = screen.getByRole('list', { name: 'Cards' });
    expect(within(cards).queryByRole('button', { name: 'Stop' })).toBeNull();
    fireEvent.click(red());
    expect(onChange).toHaveBeenLastCalledWith({ type: 'drag_matching', matches: {} });
    expect(within(cards).getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('fills in the blanks', () => {
    const onChange = renderInput({
      ...base,
      id: 'q6',
      type: 'fill_blank',
      parts: [
        { kind: 'text', text: 'Say your ' },
        { kind: 'blank', id: 'b1' },
        { kind: 'text', text: ' and the ' },
        { kind: 'blank', id: 'b2' },
      ],
    });
    const first = screen.getByRole('textbox', { name: 'Blank 1 of 2' });
    fireEvent.change(first, { target: { value: 'name' } });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'fill_blank', blanks: { b1: 'name' } });
    fireEvent.change(first, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({ type: 'fill_blank', blanks: {} });
    expect(screen.getByRole('textbox', { name: 'Blank 2 of 2' })).toHaveAttribute(
      'maxlength',
      '500',
    );
  });

  it('moves items up and down, keeping the focus on the moved item', () => {
    const onChange = renderInput({
      ...base,
      id: 'q7',
      type: 'ordering',
      items: [
        { id: 'item-1', text: 'Listen' },
        { id: 'item-2', text: 'Greet' },
        { id: 'item-3', text: 'Close' },
      ],
    });
    const texts = () =>
      screen.getAllByRole('listitem').map((item: HTMLElement) => item.textContent);
    expect(texts()).toEqual(['1Listen', '2Greet', '3Close']);
    expect(screen.getByRole('button', { name: 'Move "Listen" up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move "Greet" up' }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'ordering',
      order: ['item-2', 'item-1', 'item-3'],
    });
    expect(texts()).toEqual(['1Greet', '2Listen', '3Close']);
    expect(screen.getByRole('button', { name: 'Move "Greet" down' })).toHaveFocus();
    expect(screen.getByText('"Greet" is now 1 of 3.')).toBeInTheDocument();
  });

  it('picks an area of the picture by its label', () => {
    const onChange = renderInput({
      ...base,
      id: 'q8',
      type: 'hotspot',
      image: { media: { kind: 'url', url: 'https://example.test/hall.png' }, alt: 'A hallway' },
      spots: [
        { id: 's1', shape: 'rect', x: 10, y: 10, width: 20, height: 30, label: 'Fire exit' },
        { id: 's2', shape: 'ellipse', x: 50, y: 40, width: 10, height: 10, label: 'Light switch' },
      ],
    });
    expect(screen.getByRole('img', { name: 'A hallway' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fire exit' }));
    expect(onChange).toHaveBeenLastCalledWith({
      type: 'hotspot',
      pick: { kind: 'spot', spotId: 's1' },
    });
    expect(screen.getByRole('button', { name: 'Fire exit' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('locks the answer when disabled', () => {
    renderInput(single, true);
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled();
  });
});
