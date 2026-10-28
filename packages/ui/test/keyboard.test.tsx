import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
  SheetContent,
} from '../src';

/** A page menu whose Rename item opens a dialog, which has no trigger of its own. */
function PageMenu() {
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">Page actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
          <DropdownMenuItem>Duplicate</DropdownMenuItem>
          <DropdownMenuItem variant="danger">Move to Trash</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Rename page</DialogTitle>
          <Input aria-label="Page name" defaultValue="Visit notes" />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A dialog opened from code (here by F2 in a text field), not by a DialogTrigger. */
function NotesField({ onCloseAutoFocus }: { onCloseAutoFocus?: (event: Event) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Input
        aria-label="Notes"
        onKeyDown={(event) => {
          if (event.key === 'F2') setOpen(true);
        }}
      />
      <Input aria-label="Page title" />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
          <DialogTitle>Insert a date</DialogTitle>
          <Button>Today</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Ctrl+K opens a command window; one of its commands closes it and opens another dialog. */
function CommandWindow() {
  const [open, setOpen] = useState<'commands' | 'shortcuts' | null>(null);
  const show = (dialog: 'commands' | 'shortcuts' | null) => () => setOpen(dialog);
  return (
    <>
      <Input
        aria-label="Notes"
        onKeyDown={(event) => {
          if (event.ctrlKey && event.key === 'k') setOpen('commands');
        }}
      />
      <Dialog open={open === 'commands'} onOpenChange={show(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Commands</DialogTitle>
          <Button onClick={show('shortcuts')}>Keyboard shortcuts</Button>
        </DialogContent>
      </Dialog>
      <Dialog open={open === 'shortcuts'} onOpenChange={show(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <p>Ctrl+K opens search.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A link popover placed by an anchor, opened by a button that isn't its trigger. */
function LinkPopover() {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Add a link
        </Button>
      </PopoverAnchor>
      <PopoverContent aria-label="Link">
        <Input aria-label="Link address" />
      </PopoverContent>
    </Popover>
  );
}

const afterClosing = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('Focus goes back to what opened a pop-up', () => {
  it('after a dialog opened from a menu item, to the menu button', async () => {
    const user = userEvent.setup();
    render(<PageMenu />);
    const menuButton = screen.getByRole('button', { name: 'Page actions' });
    menuButton.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Rename' })).toHaveFocus());
    await user.keyboard('{Enter}');

    const dialog = await screen.findByRole('dialog', { name: 'Rename page' });
    await waitFor(() => expect(within(dialog).getByRole('textbox')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(menuButton).toHaveFocus());
  });

  it('after a dialog opened from code, to the field that had focus', async () => {
    const user = userEvent.setup();
    render(<NotesField />);
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await user.click(notes);
    await user.keyboard('{F2}');

    const dialog = await screen.findByRole('dialog', { name: 'Insert a date' });
    const today = within(dialog).getByRole('button', { name: 'Today' });
    await waitFor(() => expect(today).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(notes).toHaveFocus());
  });

  it('after a dialog opened from another one, to where focus was before both', async () => {
    const user = userEvent.setup();
    render(<CommandWindow />);
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await user.click(notes);
    await user.keyboard('{Control>}k{/Control}');
    const commands = await screen.findByRole('dialog', { name: 'Commands' });
    await user.click(within(commands).getByRole('button', { name: 'Keyboard shortcuts' }));

    const shortcuts = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    const close = within(shortcuts).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(close).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(notes).toHaveFocus());
  });

  it('leaves focus to a dialog that places it itself', async () => {
    const user = userEvent.setup();
    const focusTitle = (event: Event) => {
      event.preventDefault();
      screen.getByRole('textbox', { name: 'Page title' }).focus();
    };
    render(<NotesField onCloseAutoFocus={focusTitle} />);
    await user.click(screen.getByRole('textbox', { name: 'Notes' }));
    await user.keyboard('{F2}');
    await screen.findByRole('dialog', { name: 'Insert a date' });
    await user.keyboard('{Escape}');
    await afterClosing();
    expect(screen.getByRole('textbox', { name: 'Page title' })).toHaveFocus();
  });

  it('after a popover placed by an anchor, to the button that opened it', async () => {
    const user = userEvent.setup();
    render(<LinkPopover />);
    const button = screen.getByRole('button', { name: 'Add a link' });
    await user.click(button);
    const popover = await screen.findByRole('dialog', { name: 'Link' });
    await waitFor(() => expect(within(popover).getByRole('textbox')).toHaveFocus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('but after a click outside a popover, focus stays where the click put it', async () => {
    const user = userEvent.setup();
    render(
      <>
        <p>Visit notes for Tuesday</p>
        <LinkPopover />
      </>,
    );
    await user.click(screen.getByRole('button', { name: 'Add a link' }));
    await screen.findByRole('dialog', { name: 'Link' });
    await user.click(screen.getByText('Visit notes for Tuesday'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await afterClosing();
    expect(document.body).toHaveFocus();
  });

  it('after the phone menu, to its button, with focus kept inside while it is open', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Menu</Button>
        </DialogTrigger>
        <SheetContent title="Menu" closeLabel="Close menu">
          <a href="/home">Home</a>
        </SheetContent>
      </Dialog>,
    );
    const button = screen.getByRole('button', { name: 'Menu' });
    await user.click(button);
    const sheet = await screen.findByRole('dialog', { name: 'Menu' });
    const close = within(sheet).getByRole('button', { name: 'Close menu' });
    await waitFor(() => expect(close).toHaveFocus());
    await user.tab();
    expect(within(sheet).getByRole('link', { name: 'Home' })).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(button).toHaveFocus());
  });
});

describe('Escape closes only the top pop-up', () => {
  it('first a menu inside a dialog, then the dialog', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Share</Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Share page</DialogTitle>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Can edit</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Can view</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </DialogContent>
      </Dialog>,
    );
    const share = screen.getByRole('button', { name: 'Share' });
    await user.click(share);
    const dialog = await screen.findByRole('dialog', { name: 'Share page' });
    const access = within(dialog).getByRole('button', { name: 'Can edit' });
    access.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(access).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(share).toHaveFocus());
  });

  it('first a popover inside a dialog, then the dialog', async () => {
    const user = userEvent.setup();
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Share</Button>
        </DialogTrigger>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Share page</DialogTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary">Who can see this</Button>
            </PopoverTrigger>
            <PopoverContent aria-label="Access">Only people in your workspace.</PopoverContent>
          </Popover>
        </DialogContent>
      </Dialog>,
    );
    await user.click(screen.getByRole('button', { name: 'Share' }));
    const dialog = await screen.findByRole('dialog', { name: 'Share page' });
    const who = within(dialog).getByRole('button', { name: 'Who can see this' });
    await user.click(who);
    expect(await screen.findByRole('dialog', { name: 'Access' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Access' })).not.toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    await waitFor(() => expect(who).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Share page' })).not.toBeInTheDocument();
  });
});

describe('Menus with the keyboard', () => {
  it('move with Home, End and by typing the first letter of an item', async () => {
    const user = userEvent.setup();
    render(<PageMenu />);
    screen.getByRole('button', { name: 'Page actions' }).focus();
    await user.keyboard('{Enter}');
    const item = (name: string) => screen.getByRole('menuitem', { name });
    await waitFor(() => expect(item('Rename')).toHaveFocus());

    await user.keyboard('{End}');
    expect(item('Move to Trash')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('Rename')).toHaveFocus();
    await user.keyboard('d');
    expect(item('Duplicate')).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(item('Rename')).toHaveFocus();
  });
});
