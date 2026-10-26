import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
} from '../src';

describe('DropdownMenu', () => {
  it('opens, moves and chooses with the keyboard', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Page actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
          <DropdownMenuItem variant="danger" onSelect={onDelete}>
            Move to Trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'Page actions' });
    trigger.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes on Escape and gives focus back', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>Open</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>One</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const trigger = screen.getByRole('button', { name: 'Open' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('Dialog', () => {
  it('is named by its title, keeps focus inside and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Share</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Share page</DialogTitle>
          <DialogDescription>People in your workspace can open it.</DialogDescription>
          <Button>Copy link</Button>
        </DialogContent>
      </Dialog>,
    );
    const trigger = screen.getByRole('button', { name: 'Share' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Share page' });
    expect(dialog).toHaveAccessibleDescription('People in your workspace can open it.');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Copy link' })).toHaveFocus(),
    );
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Copy link' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('Tabs', () => {
  it('moves between tabs with the arrow keys', async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="details">
        <TabsList aria-label="Ticket">
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="details">Opened by Sam Rivers</TabsContent>
        <TabsContent value="history">Two replies</TabsContent>
      </Tabs>,
    );
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');

    const history = screen.getByRole('tab', { name: 'History' });
    expect(history).toHaveFocus();
    expect(history).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Two replies');
  });
});

describe('Tooltip', () => {
  it('shows on keyboard focus', async () => {
    const user = userEvent.setup();
    render(
      <Tooltip content="Add a page">
        <IconButton label="New page">
          <svg />
        </IconButton>
      </Tooltip>,
    );
    await user.tab();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Add a page');
  });
});
