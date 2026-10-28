import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraftForm, Menu, type Entry } from './Menu';

function entries() {
  const picked = vi.fn();
  const list: Entry[] = [
    { id: 'improve', label: 'Improve writing', pick: () => picked('improve') },
    { id: 'tone', label: 'Change tone', opens: true, pick: () => picked('tone') },
    { id: 'draft', label: 'Draft', hint: 'Type what you want', pick: () => picked('draft') },
  ];
  return { list, picked };
}

const item = (name: string) => screen.getByRole('menuitem', { name });

describe('Menu', () => {
  it('focuses the first entry and moves with the arrows, Home and End', () => {
    const { list } = entries();
    render(<Menu label="Ask Claude" entries={list} />);
    expect(screen.getByRole('menu', { name: 'Ask Claude' })).toBeInTheDocument();
    expect(item('Improve writing')).toHaveFocus();
    fireEvent.keyDown(item('Improve writing'), { key: 'ArrowDown' });
    expect(item('Change tone')).toHaveFocus();
    fireEvent.keyDown(item('Change tone'), { key: 'End' });
    expect(item('Draft')).toHaveFocus();
    fireEvent.keyDown(item('Draft'), { key: 'ArrowDown' });
    expect(item('Improve writing')).toHaveFocus();
    fireEvent.keyDown(item('Improve writing'), { key: 'ArrowUp' });
    expect(item('Draft')).toHaveFocus();
    fireEvent.keyDown(item('Draft'), { key: 'Home' });
    expect(item('Improve writing')).toHaveFocus();
  });

  it('picks with a click, and → opens an entry with more choices', () => {
    const { list, picked } = entries();
    render(<Menu label="Ask Claude" entries={list} />);
    expect(item('Change tone')).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(item('Improve writing'));
    fireEvent.keyDown(item('Improve writing'), { key: 'ArrowRight' });
    fireEvent.keyDown(item('Improve writing'), { key: 'ArrowDown' });
    fireEvent.keyDown(item('Change tone'), { key: 'ArrowRight' });
    expect(picked.mock.calls).toEqual([['improve'], ['tone']]);
  });

  it('reads a hint as the entry description, not its name', () => {
    render(<Menu label="Ask Claude" entries={entries().list} />);
    expect(item('Draft')).toHaveAccessibleDescription('Type what you want');
  });

  it('goes back with ←', () => {
    const onBack = vi.fn();
    render(<Menu label="Change tone" entries={entries().list} onBack={onBack} />);
    fireEvent.keyDown(item('Improve writing'), { key: 'ArrowLeft' });
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('DraftForm', () => {
  it('sends with Enter or Write, and adds a line with Shift+Enter', () => {
    const onSubmit = vi.fn();
    render(<DraftForm problem={null} onSubmit={onSubmit} onBack={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'What should Claude write?' });
    expect(box).toHaveFocus();
    fireEvent.change(box, { target: { value: 'A welcome note for Jordan' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Write' }));
    expect(onSubmit.mock.calls).toEqual([
      ['A welcome note for Jordan'],
      ['A welcome note for Jordan'],
    ]);
  });

  it('shows what is wrong under the box, and goes back', () => {
    const onBack = vi.fn();
    render(
      <DraftForm problem="Say what Claude should write." onSubmit={vi.fn()} onBack={onBack} />,
    );
    const box = screen.getByRole('textbox', { name: 'What should Claude write?' });
    expect(box).toHaveAccessibleDescription('Say what Claude should write.');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
