// Test helpers: a fake auth API on top of fetch, and a render with the app's providers.
import {
  BUILT_IN_ROLES,
  type CurrentUser,
  type MeResponse,
  type WorkspaceSummary,
} from '@carehub/shared';
import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Routes, useLocation } from 'react-router';

export const USER: CurrentUser = {
  id: '6d0f8a52-3c1e-4b7a-9f2d-1e5c7b9a0d34',
  email: 'eli.editor@example.test',
  name: 'Eli Editor',
  avatarUrl: null,
  isSiteAdmin: false,
  timeZone: 'America/Denver',
  use24h: false,
  weekStart: 0,
  mustChangePassword: false,
};

export const WORKSPACE: WorkspaceSummary = {
  id: '2b9e4c71-8d3a-4f5e-a1c6-7e0d9b3f2a58',
  name: 'Care Hub',
};

/** GET /api/auth/me for `user`: an Editor of the Care Hub workspace. */
export function meFor(user: CurrentUser = USER): MeResponse {
  return {
    user,
    member: {
      kind: 'member',
      workspaceId: WORKSPACE.id,
      roleId: '5c1f7a93-2e4d-4b8a-9f06-d3a7b2e8c140',
      roleName: BUILT_IN_ROLES.editor.name,
      permissions: [...BUILT_IN_ROLES.editor.permissions],
      isAdmin: false,
    },
    workspace: WORKSPACE,
  };
}

export interface SentRequest {
  method: string;
  url: string;
  body: unknown;
}

type Handler = (request: SentRequest) => Response | Promise<Response>;

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export interface FakeAuthServer {
  /** Who GET /api/auth/me answers with; null answers 401, signed out. */
  me: MeResponse | null;
  /** By "METHOD /path"; they win over the me answer. */
  routes: Record<string, Handler>;
  requests: SentRequest[];
}

const realFetch = globalThis.fetch;

/** Puts a fake API in place of fetch until `restoreFetch()`. Anything else answers 404. */
export function fakeAuthServer(
  me: MeResponse | null = null,
  routes: Record<string, Handler> = {},
): FakeAuthServer {
  const server: FakeAuthServer = { me, routes, requests: [] };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: SentRequest = {
      method: init?.method ?? 'GET',
      url: String(input),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    server.requests.push(request);
    const handler = server.routes[`${request.method} ${request.url}`];
    if (handler) return handler(request);
    if (request.method === 'GET' && request.url === '/api/auth/me') {
      if (server.me) return json(200, server.me);
      return json(401, { error: { code: 'signed_out', message: 'Sign in to continue.' } });
    }
    return json(404, { error: { code: 'not_found', message: 'Not found.' } });
  }) as typeof fetch;
  return server;
}

export function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

/** The requests other than GET /api/auth/me, as "METHOD /path". */
export function changes(server: FakeAuthServer): string[] {
  return server.requests
    .filter((request) => request.method !== 'GET')
    .map((request) => `${request.method} ${request.url}`);
}

function Address() {
  const { pathname, search } = useLocation();
  return <output data-testid="address">{`${pathname}${search}`}</output>;
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/**
 * Renders `<Route>`s at `path` with React Query, toasts and a router, as in the app. The address
 * is in `screen.getByTestId('address')`.
 */
export function renderRoutes(
  routes: ReactNode,
  {
    path = '/',
    queryClient = createTestQueryClient(),
  }: { path?: string; queryClient?: QueryClient } = {},
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>{routes}</Routes>
          <Address />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}
