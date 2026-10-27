import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, ThemeProvider, ThemeSwitch } from '../src';
import { setMedia } from './media';

const html = () => document.documentElement;

function renderSwitch(compact = false) {
  return render(
    <ThemeProvider>
      <ThemeSwitch compact={compact} />
    </ThemeProvider>,
  );
}

describe('theme', () => {
  it('follows the device setting until the person picks one', () => {
    setMedia({ dark: true });
    renderSwitch();
    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    expect(html()).toHaveClass('dark');
    setMedia({ dark: false });
    expect(html()).not.toHaveClass('dark');
    expect(html().style.colorScheme).toBe('light');
  });

  it('switches to dark and remembers it on this device', async () => {
    const user = userEvent.setup();
    renderSwitch();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(html()).toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(html()).not.toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('starts with the saved choice and keeps the names when compact', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderSwitch(true);
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Light' })).not.toBeChecked();
    expect(html()).toHaveClass('dark');
  });

  it('follows a change made in another tab', () => {
    renderSwitch();
    act(() => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      window.dispatchEvent(
        new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }),
      );
    });
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeChecked();
    expect(html()).toHaveClass('dark');
  });
});
