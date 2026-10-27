import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { CheckedField, type Checked } from './CheckedField';

const even = (text: string): Checked<number> =>
  Number(text) % 2 === 0
    ? { ok: true, value: Number(text) }
    : { ok: false, error: 'Use an even number.' };

function Harness({ changes }: { changes: number[] }) {
  const [value, setValue] = useState(2);
  return (
    <>
      <CheckedField
        label="Count"
        value={String(value)}
        check={even}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
      <button type="button" onClick={() => setValue(8)}>
        Undo
      </button>
    </>
  );
}

describe('CheckedField', () => {
  it('passes on accepted values only, keeping what was typed and saying why', () => {
    const changes: number[] = [];
    render(<Harness changes={changes} />);
    const box = screen.getByRole('textbox', { name: 'Count' });
    fireEvent.change(box, { target: { value: '3' } });
    expect(box).toHaveValue('3');
    expect(box).toHaveAccessibleDescription('Use an even number.');
    expect(changes).toEqual([]);
    fireEvent.change(box, { target: { value: '4' } });
    expect(changes).toEqual([4]);
    expect(screen.queryByText('Use an even number.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(box).toHaveValue('8');
  });
});
