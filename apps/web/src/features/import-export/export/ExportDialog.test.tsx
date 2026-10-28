import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportDialog } from './ExportDialog';
import { ExportOverlay } from './ExportOverlay';
import {
  exportAllowed,
  openExportDialog,
  resetExportStore,
  setExportNavigate,
  type ExportTarget,
} from './store';
import { exportView, fakeFetch, PAGE_ID, Providers, runningView } from './testing';

const guide: ExportTarget = { id: PAGE_ID, kind: 'page', title: 'Support guide' };
let downloads: string[];
let server: ReturnType<typeof fakeFetch> | undefined;

// jsdom has no ResizeObserver, and the kit's checkboxes measure themselves with one.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  downloads = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloads.push(this.getAttribute('href') ?? '');
  });
});

afterEach(() => {
  server?.restore();
  server = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetExportStore();
});

function openDialog(target: ExportTarget = guide) {
  const onClose = vi.fn();
  render(
    <Providers>
      <ExportDialog target={target} onClose={onClose} pollMs={10} />
    </Providers>,
  );
  return { onClose };
}

const exportButton = () => screen.getByRole('button', { name: 'Export' });

describe('ExportDialog', () => {
  it('downloads a small export at once, with the default options (IE-12)', async () => {
    server = fakeFetch([{ status: 201, body: { export: exportView() } }]);
    const { onClose } = openDialog();
    expect(screen.getByRole('radio', { name: /Markdown and CSV/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include sub-pages' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Include files and pictures' })).toBeChecked();

    fireEvent.click(exportButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.requests).toEqual([
      {
        url: '/api/import-export/exports',
        method: 'POST',
        body: {
          pageId: PAGE_ID,
          format: 'markdown',
          includeSubpages: false,
          includeFiles: true,
          databases: 'all',
        },
      },
    ]);
    expect(downloads).toEqual([exportView().downloadUrl]);
    expect((await screen.findAllByText('Your export is ready')).length).toBeGreaterThan(0);
  });

  it('sends the options picked: HTML, with sub-pages, without files', async () => {
    server = fakeFetch([{ status: 201, body: { export: exportView({ format: 'html' }) } }]);
    const { onClose } = openDialog();
    fireEvent.click(screen.getByRole('radio', { name: /HTML/ }));
    expect(screen.queryByText('Databases')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include sub-pages' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include files and pictures' }));
    // With sub-pages, their databases can come too.
    expect(screen.getByText('Databases')).toBeInTheDocument();
    fireEvent.click(exportButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(server.requests[0]?.body).toMatchObject({
      format: 'html',
      includeSubpages: true,
      includeFiles: false,
    });
  });

  it('shows "Preparing your export (42%)" while a big export runs (IE-15)', async () => {
    server = fakeFetch([
      { status: 201, body: { export: runningView(0, 50) } },
      { status: 200, body: { export: runningView(21, 50) } },
    ]);
    const { onClose } = openDialog();
    fireEvent.click(exportButton());
    expect(await screen.findByText('Preparing your export (42%)')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: 'Preparing your export' });
    expect((bar as HTMLProgressElement).value).toBe(42);
    expect(screen.getByText(/A 🔔 notice brings the download/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
  });

  it('downloads a big export when it is ready', async () => {
    server = fakeFetch([
      { status: 201, body: { export: runningView(0, 61) } },
      { status: 200, body: { export: exportView({ pageCount: 61 }) } },
    ]);
    const { onClose } = openDialog();
    fireEvent.click(exportButton());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(downloads).toEqual([exportView().downloadUrl]);
  });

  it('opens the Print view for PDF, without the zip options', () => {
    server = fakeFetch([]);
    const navigate = vi.fn();
    setExportNavigate(navigate);
    const { onClose } = openDialog();
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }));
    expect(screen.queryByRole('checkbox', { name: 'Include sub-pages' })).toBeNull();
    expect(screen.getByText(/Choose Save as PDF in the print dialog/)).toBeInTheDocument();
    fireEvent.click(exportButton());
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(`/p/${PAGE_ID}/print?pdf=1`);
    expect(server.requests).toEqual([]);
  });

  it('says why when the export is refused (IE-16)', async () => {
    server = fakeFetch([
      {
        status: 403,
        body: { error: { code: 'forbidden', message: "You don't have access to this." } },
      },
    ]);
    openDialog();
    fireEvent.click(exportButton());
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
    expect(downloads).toEqual([]);
  });

  it('offers This view or Everything for a database', () => {
    server = fakeFetch([]);
    openDialog({ id: PAGE_ID, kind: 'database', title: 'Callbacks' });
    expect(screen.getByRole('combobox', { name: 'Databases' })).toBeInTheDocument();
  });
});

describe('ExportOverlay', () => {
  it('asks whether Export shows as each page opens, and shows the dialog (IE-16)', async () => {
    server = fakeFetch([{ status: 200, body: { allowed: true } }]);
    render(
      <MemoryRouter initialEntries={[`/p/${PAGE_ID}`]}>
        <Providers>
          <ExportOverlay />
        </Providers>
      </MemoryRouter>,
    );
    await waitFor(() => expect(exportAllowed(PAGE_ID)).toBe(true));
    expect(server.requests[0]?.url).toBe(`/api/import-export/exports/allowed?pageId=${PAGE_ID}`);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openExportDialog(guide));
    expect(await screen.findByRole('dialog', { name: 'Export' })).toBeInTheDocument();
  });
});
