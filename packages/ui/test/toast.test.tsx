import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Button, ToastProvider, useToast } from '../src';

function SaveButton() {
  const { toast } = useToast();
  return <Button onClick={() => toast({ title: 'Page saved', variant: 'success' })}>Save</Button>;
}

describe('Toast', () => {
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
});
