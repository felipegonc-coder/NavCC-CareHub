import type { BankReply, BankSummary, QuestionBank } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { vi } from 'vitest';
import { StudioProvider } from '../context';
import { BankEditorScreen, BanksScreen } from './index';

// Test helpers for the bank screens: a pretend bank API on fetch and the two routes. Fictional data only.

type Stored = { bank: QuestionBank; revision: number; updatedAt: string };

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const failure = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } });

/**
 * Answers `/api/learning/studio/banks…` like the server, including the revision check on save (409 when someone
 * saved first). `banks` is what the server holds; change it to act as another author.
 */
export function fakeBankApi(initial: QuestionBank[] = []) {
  const banks = new Map<string, Stored>(
    initial.map((bank) => [bank.id, { bank, revision: 1, updatedAt: '2026-10-20T09:00:00.000Z' }]),
  );
  let created = 0;
  const reply = (stored: Stored): BankReply => ({ ...stored });
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined;
      const [, id] = /^\/api\/learning\/studio\/banks(?:\/([^/]+))?$/.exec(String(input)) ?? [];
      if (!id && method === 'GET') {
        const list: BankSummary[] = [...banks.values()].map(({ bank, updatedAt }) => ({
          id: bank.id,
          title: bank.title,
          ...(bank.description ? { description: bank.description } : {}),
          questionCount: bank.questions.length,
          updatedAt,
        }));
        return json(200, list);
      }
      if (!id && method === 'POST') {
        const { title, description } = body as { title: string; description?: string };
        created += 1;
        const bank: QuestionBank = {
          formatVersion: 1,
          id: `bank-${created}`,
          title,
          ...(description ? { description } : {}),
          questions: [],
        };
        const stored = { bank, revision: 1, updatedAt: '2026-10-27T09:00:00.000Z' };
        banks.set(bank.id, stored);
        return json(201, reply(stored));
      }
      const stored = id ? banks.get(decodeURIComponent(id)) : undefined;
      if (!stored) return failure(404, 'not_found', "This bank doesn't exist.");
      if (method === 'GET') return json(200, reply(stored));
      if (method === 'DELETE') {
        banks.delete(stored.bank.id);
        return json(204);
      }
      if (method === 'PUT') {
        const save = body as { bank: QuestionBank; revision: number };
        if (save.revision !== stored.revision) {
          return failure(
            409,
            'conflict',
            'Someone else saved this bank since you opened it. Reload to see their changes.',
          );
        }
        const next = {
          bank: save.bank,
          revision: stored.revision + 1,
          updatedAt: stored.updatedAt,
        };
        banks.set(stored.bank.id, next);
        return json(200, { revision: next.revision });
      }
      return failure(405, 'invalid', 'Not here.');
    });
  /** The bodies of the saves (PUT) so far. */
  const saves = () =>
    fetch.mock.calls
      .filter(([, init]) => init?.method === 'PUT')
      .map(
        ([, init]) => JSON.parse(String(init?.body)) as { bank: QuestionBank; revision: number },
      );
  return { banks, fetch, saves };
}

function Location() {
  const { pathname } = useLocation();
  return <p data-testid="location">{pathname}</p>;
}

/** Renders the bank routes at `path`, with a fresh query client that doesn't retry. */
export function renderBanks(path: string, options: { canBuild?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StudioProvider canBuild={options.canBuild ?? true}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/learning/studio/banks" element={<BanksScreen />} />
            <Route path="/learning/studio/banks/:bankId" element={<BankEditorScreen />} />
          </Routes>
          <Location />
        </MemoryRouter>
      </StudioProvider>
    </QueryClientProvider>,
  );
}
