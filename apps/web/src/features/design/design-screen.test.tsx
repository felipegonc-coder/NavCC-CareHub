import { ThemeProvider, ToastProvider } from '@carehub/ui';
import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { DesignScreen } from './design-screen';

// jsdom has no ResizeObserver; some Radix controls on this screen measure themselves.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

beforeAll(() => {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
});

describe('DesignScreen', () => {
  it('is one titled page showing the kit', () => {
    render(
      <ThemeProvider>
        <ToastProvider>
          <DesignScreen />
        </ToastProvider>
      </ThemeProvider>,
    );
    const main = screen.getByRole('main');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(within(main).getByRole('heading', { level: 1, name: 'Design kit' })).toBeVisible();
    expect(document.title).toBe('Care Hub · Design kit');
    expect(within(main).getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(within(main).getByRole('button', { name: 'Page actions' })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    );
    expect(within(main).getByRole('alert')).toHaveTextContent("Couldn't load the pages.");
    expect(within(main).getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(within(main).getByText("You don't have access to this.")).toBeVisible();
    expect(
      within(main).getByText("You're offline. Changes that need the server are paused."),
    ).toBeVisible();
  });
});
