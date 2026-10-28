// Test helpers for buttons: a fake ButtonsClient whose calls are spies, and a render helper with
// the providers the block and its settings need. Nothing here touches the network.
import type { ButtonSettings, PressResponse } from '@carehub/extras/templates/buttons';
import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';
import { ButtonsClientProvider, type ButtonsClient } from './api';
import { buttonResponse, RUN_ID, TICKETS } from './fixtures';
import type { PageStepDeps } from './page-steps';

export function pressAnswer(fields: Partial<PressResponse> = {}): PressResponse {
  return {
    runId: RUN_ID,
    pageSteps: [],
    failure: null,
    confirm: null,
    changed: false,
    messagesSent: 0,
    skipped: 0,
    undoUntil: null,
    ...fields,
  };
}

/** Undo works for 8 seconds from now. */
export const undoWindow = () => new Date(Date.now() + 8000).toISOString();

export function fakeButtons(changes: Partial<ButtonsClient> = {}) {
  return {
    create: vi.fn(async (pageId: string) => buttonResponse({ pageId })),
    get: vi.fn(async () => buttonResponse()),
    save: vi.fn(async (_id: string, _pageId: string, settings: ButtonSettings) =>
      buttonResponse({ settings }),
    ),
    press: vi.fn(async () => pressAnswer()),
    cancel: vi.fn(async () => ({ undoUntil: null as string | null })),
    undo: vi.fn(async () => ({ kept: 0, messagesSent: 0 })),
    database: vi.fn(async () => TICKETS),
    ...changes,
  } satisfies ButtonsClient;
}

/** What the page does for a press; `insertBlocks` gives back `takeOut` as the undo. */
export function fakeSteps(takeOut = vi.fn(() => true)) {
  return {
    takeOut,
    insertBlocks: vi.fn<PageStepDeps['insertBlocks']>(() => takeOut),
    openPage: vi.fn(),
    openLink: vi.fn(),
  } satisfies PageStepDeps & { takeOut: unknown };
}

// jsdom has no ResizeObserver; Radix controls in the dialogs measure themselves.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

export function renderButtons(ui: ReactElement, client: ButtonsClient = fakeButtons()) {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <ButtonsClientProvider value={client}>{ui}</ButtonsClientProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
  return { ...view, queryClient };
}
