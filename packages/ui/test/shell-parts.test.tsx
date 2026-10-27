import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Menu, Plus } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import preset from '../tailwind-preset';
import {
  breakpoints,
  Dialog,
  DialogTrigger,
  IconButton,
  SheetContent,
  SidebarGroup,
  sidebarRowClasses,
} from '../src';

function PhoneMenu() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <IconButton label="Open menu">
          <Menu aria-hidden />
        </IconButton>
      </DialogTrigger>
      <SheetContent title="Menu" closeLabel="Close menu">
        <a href="/messages">Messages</a>
      </SheetContent>
    </Dialog>
  );
}

describe('SheetContent', () => {
  it('is a dialog named by its title that closes on Escape and gives focus back', async () => {
    const user = userEvent.setup();
    render(<PhoneMenu />);
    const trigger = screen.getByRole('button', { name: 'Open menu' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: 'Menu' });
    expect(dialog).toContainElement(screen.getByRole('link', { name: 'Messages' }));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes from its close button', async () => {
    const user = userEvent.setup();
    render(<PhoneMenu />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('button', { name: 'Close menu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('SidebarGroup', () => {
  it('is a group named by its title, with its actions', () => {
    render(
      <SidebarGroup
        title="Favorites"
        actions={
          <IconButton label="New page" size="sm">
            <Plus aria-hidden />
          </IconButton>
        }
      >
        <a href="/p/visit-notes" className={sidebarRowClasses({ active: true })}>
          Visit notes
        </a>
      </SidebarGroup>,
    );
    const group = screen.getByRole('group', { name: 'Favorites' });
    expect(group).toContainElement(screen.getByRole('link', { name: 'Visit notes' }));
    expect(group).toContainElement(screen.getByRole('button', { name: 'New page' }));
  });
});

describe('breakpoints', () => {
  it('gives md: the width where the app shell switches to the phone layout', () => {
    expect(breakpoints.md).toBe('768px');
    expect(preset.theme.extend.screens).toEqual({ md: breakpoints.md });
  });
});
