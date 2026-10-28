import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Composer } from './composer';

describe('Composer', () => {
  it('sends with Enter and empties the box, while Shift+Enter starts a new line', () => {
    const sent: string[] = [];
    render(<Composer label="Reply" onSubmit={(text) => void sent.push(text)} />);
    const box = screen.getByRole('textbox', { name: 'Reply' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    fireEvent.change(box, { target: { value: 'Thursday works.' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(sent).toEqual([]);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(sent).toEqual(['Thursday works.']);
    expect(box).toHaveValue('');

    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(sent).toHaveLength(1);
  });

  it('leaves the text to the caller when it answers with a promise', async () => {
    const saves: string[] = [];
    render(
      <Composer
        label="Edit comment"
        initialText="Thursday"
        submitLabel="Save"
        onSubmit={async (text) => {
          saves.push(text);
          return false;
        }}
      />,
    );
    const box = screen.getByRole('textbox', { name: 'Edit comment' });
    fireEvent.change(box, { target: { value: 'Friday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(saves).toEqual(['Friday']);
    expect(box).toHaveValue('Friday');
  });

  it('Esc cancels, and ↑ in the empty box edits your last comment', () => {
    let cancels = 0;
    let edits = 0;
    render(
      <Composer
        label="Reply"
        onSubmit={() => undefined}
        onCancel={() => (cancels += 1)}
        onEditLast={() => (edits += 1)}
      />,
    );
    const box = screen.getByRole('textbox', { name: 'Reply' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(edits).toBe(1);
    fireEvent.change(box, { target: { value: 'Draft' } });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(edits).toBe(1);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(cancels).toBe(1);
  });

  it('counts down near the limit and won’t send more than 4,000 characters', () => {
    render(<Composer label="Reply" onSubmit={() => undefined} />);
    const box = screen.getByRole('textbox', { name: 'Reply' });
    fireEvent.change(box, { target: { value: 'a'.repeat(3799) } });
    expect(screen.queryByText(/characters left/)).toBeNull();

    fireEvent.change(box, { target: { value: 'a'.repeat(3800) } });
    expect(screen.getByText('200 characters left')).toBeInTheDocument();

    fireEvent.change(box, { target: { value: 'a'.repeat(4001) } });
    expect(screen.getByText('A comment can be up to 4,000 characters.')).toBeInTheDocument();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
