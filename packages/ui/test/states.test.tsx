import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  NoAccessState,
  NotFoundState,
  OfflineBanner,
} from '../src';

const OFFLINE = "You're offline. Changes that need the server are paused.";

function goOffline(offline: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: !offline });
  act(() => {
    window.dispatchEvent(new Event(offline ? 'offline' : 'online'));
  });
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'onLine');
  vi.useRealTimers();
});

describe('LoadingState', () => {
  it('shows nothing for 300 ms, then a skeleton screen readers hear as loading', () => {
    vi.useFakeTimers();
    render(<LoadingState label="Loading pages" />);
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Loading pages');
  });

  it('takes a skeleton shaped like the content', () => {
    render(
      <LoadingState delayMs={0}>
        <div data-testid="rows" />
      </LoadingState>,
    );
    expect(screen.getByRole('status')).toContainElement(screen.getByTestId('rows'));
  });
});

describe('EmptyState', () => {
  it('says one sentence and offers the main action', () => {
    render(<EmptyState message="No messages yet." action={<Button>New message</Button>} />);
    expect(screen.getByText('No messages yet.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'New message' })).toBeVisible();
  });
});

describe('ErrorState', () => {
  it('reads out what went wrong and retries', () => {
    const onRetry = vi.fn();
    render(<ErrorState message="Couldn't load the pages." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the pages.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows Retry as busy while retrying and ignores more clicks', () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} retrying />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load this.");
    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(retry);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('NoAccessState and NotFoundState', () => {
  it('say what the specs say', () => {
    render(
      <>
        <NoAccessState />
        <NotFoundState action={<a href="/">Go to Home</a>} />
      </>,
    );
    expect(screen.getByText("You don't have access to this.")).toBeVisible();
    expect(screen.getByText('This was deleted, or the link is wrong.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toBeVisible();
  });
});

describe('OfflineBanner', () => {
  it('appears while offline and goes away when the connection is back', () => {
    render(<OfflineBanner />);
    const region = screen.getByRole('status');
    expect(region).toBeEmptyDOMElement();

    goOffline(true);
    expect(region).toHaveTextContent(OFFLINE);

    goOffline(false);
    expect(region).toBeEmptyDOMElement();
  });

  it('starts shown if the page opens offline', () => {
    goOffline(true);
    render(<OfflineBanner />);
    expect(screen.getByRole('status')).toHaveTextContent(OFFLINE);
  });

  it('can be forced on for previews', () => {
    render(<OfflineBanner offline />);
    expect(screen.getByRole('status')).toHaveTextContent(OFFLINE);
  });
});
