import { ThemeProvider } from '@carehub/ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { House, MessageSquare } from 'lucide-react';
import type { ReactElement } from 'react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../shell/AppLayout';
import { NotFoundPage } from '../../shell/NotFoundPage';
import { loadSlots, mergeSlots, type SidebarItem, type SidebarSection } from '../../slots';
import { AppShell } from './app-shell';
import { ShellHeader } from './header';

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

const unsortedItems: SidebarItem[] = [
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
// The shell shows slots as merged: sorted by order.
const items = mergeSlots([{ sidebarItems: unsortedItems }]).sidebarItems;

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

// MemoryRouter rather than a data router: jsdom's AbortSignal breaks data-router navigation.
function renderShell(path: string, sections: SidebarSection[] = [], layout?: ReactElement) {
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={
              layout ?? (
                <AppShell
                  items={items}
                  sections={mergeSlots([{ sidebarSections: sections }]).sidebarSections}
                >
                  <Outlet />
                </AppShell>
              )
            }
          >
            <Route path="/" element={<Screen title="Home" />} />
            <Route path="/messages" element={<Screen title="Messages" />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
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

  it('shows sections in slot order and hides one that breaks', () => {
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

  it('shows the offline banner under the top bar while the browser is offline', () => {
    const offline = "You're offline. Changes that need the server are paused.";
    renderShell('/');
    expect(screen.queryByText(offline)).not.toBeInTheDocument();

    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(offline)).toBeVisible();

    Reflect.deleteProperty(window.navigator, 'onLine');
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText(offline)).not.toBeInTheDocument();
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

describe('AppLayout', () => {
  afterEach(() => loadSlots([]));

  it('reads the sidebar items and sections from the loaded slots', async () => {
    await loadSlots([
      async () => ({
        slots: {
          sidebarItems: unsortedItems,
          sidebarSections: [{ id: 'upcoming', order: 10, Component: () => <p>Upcoming events</p> }],
        },
      }),
    ]);
    renderShell('/', [], <AppLayout />);
    const nav = screen.getByRole('navigation', { name: 'Sidebar' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link: HTMLElement) => link.textContent)).toEqual([
      'Home',
      expect.stringMatching(/^Messages/),
      'Settings',
    ]);
    expect(within(nav).getByText('Upcoming events')).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  });
});
