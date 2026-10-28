import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button, ToastProvider, useToast } from '../src';

function SaveButton() {
  const { toast } = useToast();
  return <Button onClick={() => toast({ title: 'Page saved', variant: 'success' })}>Save</Button>;
}

function ArchiveButton({ onUndo }: { onUndo: () => void }) {
  const { toast } = useToast();
  const action = { label: 'Undo', onClick: onUndo };
  return <Button onClick={() => toast({ title: 'Ticket archived', action })}>Archive</Button>;
}

describe('Toast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a message and can be dismissed', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <SaveButton />
      </ToastProvider>,
    );
    expect(screen.getByRole('region', { name: /Notifications/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    const title = await screen.findByText('Page saved');
    const toast = title.closest('li') as HTMLElement;
    expect(toast).toBeInTheDocument();

    await user.click(within(toast).getByRole('button', { name: 'Dismiss notification' }));
    await waitFor(() => expect(screen.queryByText('Page saved')).not.toBeInTheDocument());
  });

  it('runs its action, such as Undo, and then closes', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <ArchiveButton onUndo={onUndo} />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const toast = (await screen.findByText('Ticket archived')).closest('li') as HTMLElement;

    await user.click(within(toast).getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Ticket archived')).not.toBeInTheDocument());
  });

  it('keeps a toast with an action for 8 seconds, others for 5', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <SaveButton />
        <ArchiveButton onUndo={() => undefined} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText('Page saved')).not.toBeInTheDocument();
    expect(screen.getByText('Ticket archived')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('Ticket archived')).not.toBeInTheDocument();
  });
});
