import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { MemoryRouter, useInRouterContext } from 'react-router';
import type { StudioClient } from './data/client';
import { createMemoryStudioClient } from './data/memory-client';

type StudioContextValue = { client: StudioClient; canBuild: boolean };

const StudioContext = createContext<StudioContextValue | null>(null);

let browserClient: StudioClient | null = null;

// Until B1's Studio course API is on main, drafts are kept in this browser (the same calls and checks).
function defaultClient(): StudioClient {
  browserClient ??= createMemoryStudioClient(
    typeof localStorage === 'undefined' ? {} : { storage: localStorage },
  );
  return browserClient;
}

/** Props for {@link StudioProvider}. */
export type StudioProviderProps = {
  /** Where drafts are kept. Defaults to this browser's storage until the Studio server API lands. */
  client?: StudioClient;
  /** Whether this person may build courses (the `learning.build` permission). */
  canBuild?: boolean;
  children: ReactNode;
};

/** Gives the Studio screens inside it their client and access; tests pass their own. */
export function StudioProvider({ client, canBuild = true, children }: StudioProviderProps) {
  const value = useMemo(
    () => ({ client: client ?? defaultClient(), canBuild }),
    [client, canBuild],
  );
  return <StudioContext value={value}>{children}</StudioContext>;
}

/** The StudioClient for the screens below. */
export function useStudioClient(): StudioClient {
  return useContext(StudioContext)?.client ?? defaultClient();
}

/**
 * Whether this person may use Studio. A stand-in for core's `usePermission('learning.build')` (0007 section 5.2)
 * until it lands; the server checks the permission on every Studio call either way.
 */
export function useCanBuild(): boolean {
  return useContext(StudioContext)?.canBuild ?? true;
}

/** What people without `learning.build` see on a Studio link. */
export function NoAccess() {
  return (
    <main className="mx-auto max-w-page px-6 py-16">
      <title>Care Hub · Studio</title>
      <h1 className="text-title text-fg">You don't have access</h1>
      <p className="mt-2 text-body text-muted">
        Studio is for people who build trainings. Ask an admin if you need it.
      </p>
    </main>
  );
}

function Gate({ children }: { children: ReactNode }) {
  return useCanBuild() ? children : <NoAccess />;
}

/**
 * Wraps a Studio screen: only people who may build see it. Also adds the query client, router and Studio
 * context when the screen is rendered on its own (the app provides the first two).
 */
export function StudioRoot({ children }: { children: ReactNode }) {
  const hasQueryClient = useContext(QueryClientContext) !== undefined;
  const inRouter = useInRouterContext();
  const hasStudio = useContext(StudioContext) !== null;
  const [fallback] = useState(() => (hasQueryClient ? null : new QueryClient()));
  let content = <Gate>{children}</Gate>;
  if (!hasStudio) content = <StudioProvider>{content}</StudioProvider>;
  if (!inRouter) content = <MemoryRouter>{content}</MemoryRouter>;
  if (fallback) content = <QueryClientProvider client={fallback}>{content}</QueryClientProvider>;
  return content;
}
