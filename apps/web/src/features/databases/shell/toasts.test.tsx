import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@carehub/databases';
import { TOAST_MS, ToastProvider, useToasts, WithToasts, type ToastInput } from './toasts';

function ShowButton({ toast, label = 'Show' }: { toast: ToastInput; label?: string }) {
  const toasts = useToasts();
  return (
    <button type="button" onClick={() => toasts.show(toast)}>
      {label}
    </button>
  );
}

/** Shows the toast; "Show another" shows "Saved." in its place. */
function show(toast: ToastInput) {
  const rendered = render(
    <ToastProvider>
      <ShowButton toast={toast} />
      <ShowButton toast={{ message: 'Saved.' }} label="Show another" />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  return rendered;
}

describe('toasts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the message, and Undo takes the change back', () => {
    const onUndo = vi.fn();
    show({ message: 'Moved to Trash.', onUndo });
    expect(screen.getByRole('status')).toHaveTextContent('Moved to Trash.');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Moved to Trash.')).toBeNull();
  });

  it('keeps Undo for 8 seconds', () => {
    vi.useFakeTimers();
    show({ message: 'Moved to Trash.', onUndo: vi.fn() });
    act(() => {
      vi.advanceTimersByTime(LIMITS.undoToastMs - 1);
    });
    expect(screen.getByText('Moved to Trash.')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByText('Moved to Trash.')).toBeNull();
  });

  it('hides a message without Undo sooner', () => {
    vi.useFakeTimers();
    show({ message: 'Something went wrong. Try again.' });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    act(() => {
      vi.advanceTimersByTime(TOAST_MS);
    });
    expect(screen.queryByText('Something went wrong. Try again.')).toBeNull();
  });

  it('uses the toasts around it when there are some', () => {
    render(
      <ToastProvider>
        <WithToasts>
          <ShowButton toast={{ message: 'Saved.' }} />
        </WithToasts>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
  });

  it('runs onDone once when the time for Undo is up', () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    show({ message: 'View deleted.', onUndo: vi.fn(), onDone });
    act(() => {
      vi.advanceTimersByTime(LIMITS.undoToastMs);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('never runs onDone after Undo', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    const onDone = vi.fn();
    const { unmount } = show({ message: 'View deleted.', onUndo, onDone });
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    act(() => {
      vi.advanceTimersByTime(LIMITS.undoToastMs);
    });
    unmount();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('runs onDone when another toast takes its place, or the screen closes', () => {
    const replaced = vi.fn();
    const { unmount } = show({ message: 'View deleted.', onUndo: vi.fn(), onDone: replaced });
    fireEvent.click(screen.getByRole('button', { name: 'Show another' }));
    expect(replaced).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Saved.');
    unmount();

    const closed = vi.fn();
    show({ message: 'View deleted.', onUndo: vi.fn(), onDone: closed }).unmount();
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
