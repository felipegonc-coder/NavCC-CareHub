// The Print view, `/p/:pageId/print` (Import and export spec, section 3.3): the page alone, without
// the sidebar, top bar, comments or buttons, printed with the browser's print dialog. PDF goes
// through it for now: the browser's Save as PDF makes the file, and the paper size and scale are
// set in that dialog. `?dialog=1` (page menu → Print) and `?pdf=1` (Export → PDF) open the dialog
// once the page and its pictures have loaded.
import './print.css';
import {
  applyTheme,
  Button,
  ErrorState,
  Field,
  LoadingState,
  NoAccessState,
  NotFoundState,
  Switch,
} from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useParams, useSearchParams } from 'react-router';
import { ApiError } from '../../../lib/api';
import { fetchPrintView, type PrintView } from './api';
import { PageBlocks } from './PageBlocks';

/** How long the print dialog waits for pictures that are still loading. */
const PICTURE_WAIT_MS = 10_000;

/** Resolves once every picture in `root` has loaded or failed, or after `ms`. */
function picturesLoaded(root: HTMLElement, ms: number): Promise<void> {
  const waiting = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  if (waiting.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    let left = waiting.length;
    const timer = window.setTimeout(resolve, ms);
    const settle = () => {
      left -= 1;
      if (left > 0) return;
      window.clearTimeout(timer);
      resolve();
    };
    for (const img of waiting) {
      img.addEventListener('load', settle, { once: true });
      img.addEventListener('error', settle, { once: true });
    }
  });
}

/**
 * While the view shows, the app behind it can't be reached, and only the view prints: print.css
 * hides everything else under `html.ch-printing`.
 */
function useCover(root: HTMLElement | null) {
  useLayoutEffect(() => {
    if (!root) return;
    const html = document.documentElement;
    html.classList.add('ch-printing');
    const others = [...document.body.children].filter(
      (element) => element !== root && !element.hasAttribute('inert'),
    );
    for (const element of others) element.setAttribute('inert', '');
    return () => {
      html.classList.remove('ch-printing');
      for (const element of others) element.removeAttribute('inert');
    };
  }, [root]);
}

/** On paper: the light colours whatever the theme, and the page's title as the PDF's name. */
function usePaper(title: string | null) {
  useEffect(() => {
    let undo: (() => void) | null = null;
    const after = () => {
      undo?.();
      undo = null;
    };
    const before = () => {
      after();
      const dark = document.documentElement.classList.contains('dark');
      const shown = document.title;
      if (dark) applyTheme('light');
      if (title) document.title = title;
      undo = () => {
        if (dark) applyTheme('dark');
        document.title = shown;
      };
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      after();
    };
  }, [title]);
}

/** Opens the print dialog once, when `ready`, after the pictures have loaded. */
function useAutoPrint(ready: boolean, root: HTMLElement | null) {
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || !root || printed.current) return;
    let cancelled = false;
    let timer = 0;
    void picturesLoaded(root, PICTURE_WAIT_MS).then(() => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        printed.current = true;
        window.print();
      }, 0);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ready, root]);
}

function titleOf(view: PrintView): string {
  return view.page.title.replace(/\s+/g, ' ').trim() || 'Untitled';
}

function PrintPage({ view, openAll }: { view: PrintView; openAll: boolean }) {
  return (
    <>
      <h1 className="text-title">
        {view.page.icon && <span aria-hidden="true">{view.page.icon} </span>}
        {titleOf(view)}
      </h1>
      {view.properties.length > 0 && (
        <dl className="flex flex-col gap-1 text-small">
          {view.properties.map(({ name, value }, index) => (
            <div key={index} className="flex gap-4">
              <dt className="w-1/3 shrink-0 text-muted">{name}</dt>
              <dd className="min-w-0 flex-1 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <PageBlocks
        blocks={view.blocks}
        pages={view.pages}
        databases={view.databases}
        openAll={openAll}
      />
    </>
  );
}

export function PrintScreen() {
  const { pageId = '' } = useParams();
  const [search] = useSearchParams();
  const pdf = search.get('pdf') === '1';
  const [openAll, setOpenAll] = useState(false);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const main = useRef<HTMLElement>(null);
  const query = useQuery({
    queryKey: ['import-export', 'print', pageId],
    queryFn: ({ signal }) => fetchPrintView(pageId, signal),
    retry: false,
  });
  const view = query.data;
  const status = query.error instanceof ApiError ? query.error.status : 0;

  useCover(root);
  usePaper(view ? titleOf(view) : null);
  useAutoPrint((pdf || search.get('dialog') === '1') && view !== undefined, root);
  useEffect(() => main.current?.focus({ preventScroll: true }), []);

  return createPortal(
    <div
      ref={setRoot}
      className="ch-print-root fixed inset-0 z-50 overflow-y-auto bg-bg text-fg print:static print:overflow-visible"
    >
      <title>{view ? `Care Hub · Print · ${titleOf(view)}` : 'Care Hub · Print'}</title>
      <main ref={main} tabIndex={-1} className="flex min-h-full flex-col focus:outline-none">
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-bg px-4 py-2 print:hidden">
          <Button asChild variant="ghost">
            <Link to={`/p/${encodeURIComponent(pageId)}`}>
              <ArrowLeft aria-hidden />
              Back to page
            </Link>
          </Button>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-x-4 gap-y-2">
            <Field label="Open all toggles" layout="inline">
              <Switch checked={openAll} onCheckedChange={setOpenAll} />
            </Field>
            <Button disabled={!view} onClick={() => window.print()}>
              <Printer aria-hidden />
              Print
            </Button>
          </div>
        </div>
        {pdf && (
          <p className="mx-auto w-full max-w-page px-4 pt-4 text-small text-muted md:px-6 print:hidden">
            To make the PDF, choose Save as PDF in the print dialog. Set the paper size and scale
            there too.
          </p>
        )}
        <article className="mx-auto flex w-full max-w-page flex-col gap-4 px-4 py-8 md:px-6 print:p-0">
          {view ? (
            <PrintPage view={view} openAll={openAll} />
          ) : status === 403 ? (
            <NoAccessState />
          ) : status === 404 || status === 400 ? (
            <NotFoundState />
          ) : query.error ? (
            <ErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />
          ) : (
            <LoadingState label="Loading the page" />
          )}
        </article>
      </main>
    </div>,
    document.body,
  );
}
