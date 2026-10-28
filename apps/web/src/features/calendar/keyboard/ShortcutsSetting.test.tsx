import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsSetting } from './ShortcutsSetting';

describe('ShortcutsSetting', () => {
  it('shows the setting and reports a change', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ShortcutsSetting on onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: 'Single-key shortcuts' });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      'T, D, W, M, J, K, C and more. Never while you type in a field.',
    );
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith(false);
    rerender(<ShortcutsSetting on={false} onChange={onChange} />);
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('can wait for the settings to load', () => {
    render(<ShortcutsSetting on onChange={vi.fn()} disabled />);
    expect(screen.getByRole('switch', { name: 'Single-key shortcuts' })).toBeDisabled();
  });

  it('lists every shortcut, and says when single keys are off', () => {
    render(<ShortcutsSetting on={false} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'See all shortcuts' }));
    const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog).toHaveAccessibleDescription(
      'Single-key shortcuts are off. Turn them on in Calendar settings.',
    );
    expect(screen.getByText('Move it a day earlier or later')).toBeInTheDocument();
  });
});
