import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { ExportScreen } from './ExportScreen';
import { EXPORT_ID, exportView, fakeFetch, Providers, runningView } from './testing';

let server: ReturnType<typeof fakeFetch> | undefined;
afterEach(() => {
  server?.restore();
  server = undefined;
});

function show(answer: { status: number; body: unknown }) {
  server = fakeFetch([answer]);
  render(
    <MemoryRouter initialEntries={[`/exports/${EXPORT_ID}`]}>
      <Providers>
        <Routes>
          <Route path="/exports/:exportId" element={<ExportScreen />} />
        </Routes>
      </Providers>
    </MemoryRouter>,
  );
}

describe('ExportScreen', () => {
  it('has the download for its maker, and says until when (IE-15)', async () => {
    show({ status: 200, body: { export: exportView({ skippedCount: 2 }) } });
    const link = await screen.findByRole('link', { name: 'Download' });
    expect(link).toHaveAttribute('href', `/api/import-export/exports/${EXPORT_ID}/download`);
    expect(screen.getByText('Support guide.zip')).toBeInTheDocument();
    expect(screen.getByText('2 KB · 3 pages')).toBeInTheDocument();
    expect(screen.getByText("2 pages left out because you can't open them.")).toBeInTheDocument();
    expect(screen.getByText('The link works only for you, until Nov 3, 2026.')).toBeInTheDocument();
    expect(server?.requests[0]?.url).toBe(`/api/import-export/exports/${EXPORT_ID}`);
  });

  it('shows the progress of a running export', async () => {
    show({ status: 200, body: { export: runningView(30, 120) } });
    expect(
      await screen.findByText('Preparing your export (25%)', { selector: 'p:not(.sr-only)' }),
    ).toBeInTheDocument();
  });

  it('says when the link has expired', async () => {
    show({ status: 200, body: { export: exportView({ status: 'expired', downloadUrl: null }) } });
    expect(await screen.findByText('This download link has expired.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
  });

  it("shows no access for someone else's export", async () => {
    show({
      status: 403,
      body: { error: { code: 'forbidden', message: "You don't have access to this." } },
    });
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
  });
});
