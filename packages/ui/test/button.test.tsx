import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, IconButton } from '../src';

describe('Button', () => {
  it('is a plain button that runs onClick from the keyboard', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');

    await user.tab();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ignores clicks and says it is busy while loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('can style a link instead', () => {
    render(
      <Button asChild variant="secondary">
        <a href="/p/welcome">Open page</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Open page' });
    expect(link).toHaveAttribute('href', '/p/welcome');
    expect(link).not.toHaveAttribute('type');
  });
});

describe('IconButton', () => {
  it('is named by its label', () => {
    render(
      <IconButton label="Close">
        <svg />
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
