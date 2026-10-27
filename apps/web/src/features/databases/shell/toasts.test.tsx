import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@carehub/databases';
import { TOAST_MS, ToastProvider, useToasts, WithToasts, type ToastInput } from './toasts';

function ShowButton({ toast }: { toast: ToastInput }) {
  const toasts = useToasts();
  return (
    <button type="button" onClick={() => toasts.show(toast)}>
      Show
    </button>
  );
}

function show(toast: ToastInput) {
  render(
    <ToastProvider>
      <ShowButton toast={toast} />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
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
});
