import { ThemeProvider } from '@carehub/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { House, MessageSquare } from 'lucide-react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';
import { ShellHeader } from './header';
import { Component as NotFound } from './not-found';
import type { SidebarItem, SidebarSection } from './types';

// A fake window width for the shell's media query.
let width = 1280;
const listeners = new Set<() => void>();

function setWidth(next: number) {
  act(() => {
    width = next;
    for (const listener of listeners) listener();
  });
}

beforeEach(() => {
  width = 1280;
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      media: query,
      matches: min ? width >= Number(min[1]) : false,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    } as unknown as MediaQueryList;
  };
});

afterEach(() => {
  cleanup();
  listeners.clear();
});

const items: SidebarItem[] = [
  {
    id: 'messages',
    label: 'Messages',
    icon: MessageSquare,
    to: '/messages',
    order: 20,
    useBadge: () => 3,
  },
  { id: 'home', label: 'Home', icon: House, to: '/', order: 10 },
];

// Browsers read "Messages, 3 new"; jsdom puts a space between the spans ("Messages , 3 new").
const badgeName = /^Messages ?, 3 new$/;

function Screen({ title }: { title: string }) {
  return (
    <main>
      <h1>{title}</h1>
      <ShellHeader>
        <span>{title} actions</span>
      </ShellHeader>
    </main>
  );
}

function renderShell(path: string, sections: SidebarSection[] = []) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <AppShell items={items} sections={sections}>
            <Outlet />
          </AppShell>
        ),
        children: [
          { path: '/', element: <Screen title="Home" /> },
          { path: '/messages', element: <Screen title="Messages" /> },
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <ThemeProvider>
      <RouterProvider router={router} />
    </ThemeProvider>,
  );
}

describe('AppShell', () => {
  it('lists the sidebar links in order, marks the current one and reads its badge', () => {
    renderShell('/messages');
    const links = within(screen.getByRole('navigation', { name: 'Sidebar' })).getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAccessibleName('Home');
    expect(links[0]).not.toHaveAttribute('aria-current');
    expect(links[1]).toHaveAccessibleName(badgeName);
    expect(links[1]).toHaveAttribute('aria-current', 'page');
    expect(links[2]).toHaveAccessibleName('Settings');

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(within(screen.getByRole('banner')).getByText('Messages actions')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
  });

  it('shows sections in order and hides one that breaks', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderShell('/', [
      { id: 'upcoming', order: 20, Component: () => <p>Upcoming events</p> },
      {
        id: 'broken',
        order: 15,
        Component: () => {
          throw new Error('Broken section');
        },
      },
      { id: 'tree', order: 10, Component: () => <p>Team space</p> },
    ]);
    const nav = screen.getByRole('navigation', { name: 'Sidebar' });
    const texts = within(nav).getAllByText(/Upcoming events|Team space/);
    expect(texts.map((node: HTMLElement) => node.textContent)).toEqual([
      'Team space',
      'Upcoming events',
    ]);
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    consoleError.mockRestore();
  });

  it('starts with a skip link to the screen', () => {
    renderShell('/');
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(document.body.querySelector('a[href], button')).toBe(skip);
    fireEvent.click(skip);
    expect(document.getElementById('main-content')).toHaveFocus();
  });

  it('opens the sidebar as a menu on phones', async () => {
    setWidth(390);
    renderShell('/');
    expect(screen.queryByRole('navigation', { name: 'Sidebar' })).not.toBeInTheDocument();
    const open = screen.getByRole('button', { name: 'Open menu' });

    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Menu' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(open).toHaveFocus());

    fireEvent.click(open);
    const menu = screen.getByRole('dialog', { name: 'Menu' });
    fireEvent.click(within(menu).getByRole('link', { name: badgeName }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeVisible();
    setWidth(1280);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  });

  it('shows Not found for a path nothing matches', () => {
    renderShell('/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeVisible();
    expect(screen.getByText('This was deleted, or the link is wrong.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(document.title).toBe('Care Hub · Not found');
  });
});
