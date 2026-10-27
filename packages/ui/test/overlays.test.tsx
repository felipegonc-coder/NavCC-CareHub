import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
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
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

describe('Bottom sheets on phones', () => {
  // jsdom has no layout, so these check what the layout hangs on: `data-sheet` (styles.css frees
  // Radix's placement with it) and the phone classes. The browser tests (DK-23) check the layout.
  const popUps: [string, string, ReactElement][] = [
    [
      'a menu',
      'menu',
      <DropdownMenu open key="menu">
        <DropdownMenuTrigger>Page actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Rename</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    ],
    [
      'a popover',
      'dialog',
      <Popover open key="popover">
        <PopoverTrigger>Details</PopoverTrigger>
        <PopoverContent>Last edited by Alex Morgan today.</PopoverContent>
      </Popover>,
    ],
    [
      'a select list',
      'listbox',
      <Select open key="select">
        <SelectTrigger aria-label="Team">
          <SelectValue placeholder="Choose a team" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="support">Support</SelectItem>
        </SelectContent>
      </Select>,
    ],
  ];

  it.each(popUps)(
    '%s opens as a bottom sheet',
    (_name: string, role: string, popUp: ReactElement) => {
      render(popUp);
      const sheet = screen.getByRole(role);
      expect(sheet).toHaveAttribute('data-sheet');
      expect(sheet).toHaveClass('max-md:w-full', 'max-md:max-h-sheet', 'max-md:rounded-b-none');
    },
  );

  it('keeps a select list placed over its field as it is', () => {
    render(
      <Select open>
        <SelectTrigger aria-label="Team">
          <SelectValue placeholder="Choose a team" />
        </SelectTrigger>
        <SelectContent position="item-aligned">
          <SelectItem value="support">Support</SelectItem>
        </SelectContent>
      </Select>,
    );
    expect(screen.getByRole('listbox')).not.toHaveAttribute('data-sheet');
  });

  it('lays a dialog along the bottom edge, as wide as the screen', () => {
    render(
      <Dialog open>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Share page</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Share page' });
    expect(dialog).toHaveClass('max-md:mx-0', 'max-md:mb-0', 'max-md:max-w-none');
    expect(dialog.parentElement).toHaveClass('max-md:px-0', 'max-md:pb-0');
  });
});
