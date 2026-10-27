// Test helpers for the export screens: a fake fetch with queued answers, and the providers.
import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import type { ExportView } from './api';

export const PAGE_ID = '3f0c2a52-8a7e-4c3e-9d55-6a0f1d9b7c21';
export const EXPORT_ID = 'b8a1e3a4-5c0d-4f7e-8a2b-9c1d2e3f4a5b';

export function exportView(overrides: Partial<ExportView> = {}): ExportView {
  return {
    id: EXPORT_ID,
    pageId: PAGE_ID,
    format: 'markdown',
    status: 'ready',
    progress: { done: 3, total: 3 },
    pageCount: 3,
    skippedCount: 0,
    fileName: 'Support guide.zip',
    sizeBytes: 2400,
    expiresAt: '2026-11-03T12:00:00.000Z',
    downloadUrl: `/api/import-export/exports/${EXPORT_ID}/download`,
    error: null,
    ...overrides,
  };
}

export const runningView = (done: number, total: number) =>
  exportView({
    status: 'running',
    progress: { done, total },
    pageCount: total,
    fileName: null,
    sizeBytes: null,
    expiresAt: null,
    downloadUrl: null,
  });

export interface FakeRequest {
  url: string;
  method: string;
  body: unknown;
}

/** Answers fetch calls in order; once they run out, `last` answers every call. */
export function fakeFetch(answers: { status: number; body: unknown }[]) {
  const requests: FakeRequest[] = [];
  const real = globalThis.fetch;
  let last = answers[answers.length - 1];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    const answer = answers.shift() ?? last;
    last = answer;
    return new Response(JSON.stringify(answer?.body ?? {}), {
      status: answer?.status ?? 500,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    requests,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
