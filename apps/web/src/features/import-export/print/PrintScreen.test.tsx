import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { fakeFetch, PAGE_ID, Providers } from '../export/testing';
import { PrintScreen } from './PrintScreen';

const page = {
  page: { id: PAGE_ID, kind: 'page', title: 'Support guide', icon: '📘' },
  properties: [],
  blocks: [
    {
      type: 'toggle',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Night visits' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Ring twice.' }] },
      ],
    },
  ],
  pages: {},
};

let server: ReturnType<typeof fakeFetch> | undefined;
let print: MockInstance<() => void>;
beforeEach(() => {
  print = vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  server?.restore();
  server = undefined;
  print.mockRestore();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
});

function show(query = '', answer: { status: number; body: unknown } = { status: 200, body: page }) {
  server = fakeFetch([answer]);
  render(
    <MemoryRouter initialEntries={[`/p/${PAGE_ID}/print${query}`]}>
      <Providers>
        <Routes>
          <Route path="/p/:pageId/print" element={<PrintScreen />} />
        </Routes>
      </Providers>
    </MemoryRouter>,
  );
}

describe('PrintScreen', () => {
  it('shows the page alone, with Print and Open all toggles', async () => {
    show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Support guide' })).toBeVisible();
    expect(server?.requests[0]?.url).toBe(`/api/import-export/print/${PAGE_ID}`);
    expect(document.querySelectorAll('main')).toHaveLength(1);
    expect(document.documentElement).toHaveClass('ch-printing');
    const others = [...document.body.children].filter((el) => !el.matches('.ch-print-root'));
    expect(others.every((el) => el.hasAttribute('inert'))).toBe(true);
    expect(screen.getByRole('link', { name: 'Back to page' })).toHaveAttribute(
      'href',
      `/p/${PAGE_ID}`,
    );

    const toggle = screen.getByText('Night visits').closest('details');
    expect(toggle).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('switch', { name: 'Open all toggles' }));
    expect(toggle).toHaveAttribute('open');

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('opens the print dialog for a PDF and says how to save it (IE-13)', async () => {
    show('?pdf=1');
    expect(await screen.findByText(/choose Save as PDF in the print dialog/)).toBeVisible();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
  });

  it('prints in the light colours, with the page title as the file name', async () => {
    document.documentElement.classList.add('dark');
    show();
    await screen.findByRole('heading', { level: 1, name: 'Support guide' });
    await waitFor(() => expect(document.title).toBe('Care Hub · Print · Support guide'));
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(document.title).toBe('Support guide');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.documentElement).toHaveClass('dark');
    expect(document.title).toBe('Care Hub · Print · Support guide');
  });

  it("doesn't show a page they can't open", async () => {
    show('', {
      status: 403,
      body: { error: { code: 'forbidden', message: "You don't have access to this." } },
    });
    expect(await screen.findByText("You don't have access to this.")).toBeVisible();
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('gives the app back when it closes', async () => {
    show();
    await screen.findByRole('heading', { level: 1, name: 'Support guide' });
    fireEvent.click(screen.getByRole('link', { name: 'Back to page' }));
    await waitFor(() => expect(document.documentElement).not.toHaveClass('ch-printing'));
    expect([...document.body.children].some((el) => el.hasAttribute('inert'))).toBe(false);
  });
});
