import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, ThemeProvider, ThemeToggle, themeScript } from '../src';
import { setMedia } from './media';

const html = () => document.documentElement;

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe('theme', () => {
  it('follows the device setting until the person picks one', () => {
    setMedia({ dark: true });
    renderToggle();
    expect(html()).toHaveClass('dark');
    setMedia({ dark: false });
    expect(html()).not.toHaveClass('dark');
  });

  it('switches to dark from the keyboard and remembers it', async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.tab();
    const toggle = screen.getByRole('button', { name: 'Change theme' });
    expect(toggle).toHaveFocus();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveFocus());
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toBeChecked();
    await user.keyboard('{ArrowDown}{Enter}');

    expect(html()).toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('starts with the saved choice', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderToggle();
    expect(html()).toHaveClass('dark');
  });

  it('has an inline script that applies the theme before React loads', () => {
    setMedia({ dark: true });
    globalThis.eval(themeScript);
    expect(html()).toHaveClass('dark');

    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    globalThis.eval(themeScript);
    expect(html()).not.toHaveClass('dark');
    expect(html().style.colorScheme).toBe('light');
  });
});
