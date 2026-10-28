import type { FilterValue } from '@carehub/databases';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DateRangeValue, DateValue, WindowValue, type DateInputProps } from './date-input';

const INPUTS = { date: DateValue, range: DateRangeValue, window: WindowValue };

/** Holds the value like the panel does, and reports every change. */
function Harness({
  kind,
  onChange,
}: {
  kind: keyof typeof INPUTS;
  onChange: DateInputProps['onChange'];
}) {
  const [value, setValue] = useState<FilterValue | undefined>(undefined);
  const Input = INPUTS[kind];
  return (
    <Input
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function renderInput(kind: keyof typeof INPUTS) {
  const onChange = vi.fn<DateInputProps['onChange']>();
  render(<Harness kind={kind} onChange={onChange} />);
  return onChange;
}
const select = (name: string) => screen.getByRole('combobox', { name });
const choose = (name: string, value: string) =>
  fireEvent.change(select(name), { target: { value } });
const optionTexts = (el: HTMLElement) =>
  within(el)
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('date values', () => {
  it('takes a relative day or an exact date', () => {
    const onChange = renderInput('date');
    expect(optionTexts(select('Date'))).toEqual([
      'Choose a date',
      'Today',
      'Tomorrow',
      'Yesterday',
      'One week ago',
      'One week from now',
      'One month ago',
      'One month from now',
      'Exact date',
    ]);
    choose('Date', 'today');
    expect(onChange).toHaveBeenLastCalledWith({ relative: 'today' });
    choose('Date', 'exact');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(screen.getByLabelText('Date: Exact date'), {
      target: { value: '2026-10-30' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ exact: '2026-10-30' });
  });

  it('takes two dates for "Is between", the end following the start until it is set', () => {
    const onChange = renderInput('range');
    choose('Start', 'today');
    expect(onChange).toHaveBeenLastCalledWith({
      start: { relative: 'today' },
      end: { relative: 'today' },
    });
    choose('End', 'one_week_from_now');
    expect(onChange).toHaveBeenLastCalledWith({
      start: { relative: 'today' },
      end: { relative: 'one_week_from_now' },
    });
  });

  it('takes a named window for "Is within"', () => {
    const onChange = renderInput('window');
    expect(optionTexts(select('Within'))).toEqual([
      'Choose a date',
      'This week',
      'Last week',
      'Next week',
      'Past 7 days',
      'Next 7 days',
      'This month',
      'Last month',
      'Next month',
      'Past 30 days',
      'Next 30 days',
      'This year',
      'Last year',
      'Next year',
      'Custom',
    ]);
    choose('Within', 'past_7_days');
    expect(onChange).toHaveBeenLastCalledWith('past_7_days');
  });

  it('takes a custom window, and says when the count is not a whole number from 1 to 1,000', () => {
    const onChange = renderInput('window');
    choose('Within', 'custom');
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'past', count: 1, unit: 'week' });
    const count = screen.getByRole('textbox', { name: 'How many' });
    fireEvent.change(count, { target: { value: '0' } });
    fireEvent.blur(count);
    expect(screen.getByText('Enter a whole number from 1 to 1,000.')).toBeInTheDocument();
    expect(count).toHaveAttribute('aria-invalid', 'true');
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(count, { target: { value: '3' } });
    fireEvent.keyDown(count, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'past', count: 3, unit: 'week' });
    expect(optionTexts(select('Unit'))).toEqual(['days', 'weeks', 'months', 'years']);
    choose('Unit', 'month');
    choose('Past or next', 'next');
    expect(onChange).toHaveBeenLastCalledWith({ direction: 'next', count: 3, unit: 'month' });
  });
});
