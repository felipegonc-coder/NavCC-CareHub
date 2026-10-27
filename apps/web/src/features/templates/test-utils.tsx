// Test helpers for the gallery screens: made-up cards, a fake TemplatesClient and a render
// helper with the providers and routes the screens need. Nothing here touches the network.
import type { TemplateCard } from '@carehub/extras/templates/gallery';
import type {
  GalleryResponse,
  SaveTemplateInput,
  TemplatePreviewResponse,
  UpdateTemplateInput,
} from '@carehub/extras/templates/schemas';
import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi } from 'vitest';
import { TemplatesClientProvider, type TemplatesClient } from './api';

export const LAUNCH_ID = '6c1f2f64-5f39-4f6a-9d63-0f1f7b9e2a10';
export const PAGE_ID = '0b8e7f0e-3d0a-4c1e-8a59-9a7c6f0d4e21';
export const NEW_PAGE_ID = 'c5d4a3b2-1f0e-4d9c-8b7a-6e5f4d3c2b1a';
export const NEW_TEMPLATE_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

export function card(
  fields: Partial<TemplateCard> & Pick<TemplateCard, 'id' | 'name'>,
): TemplateCard {
  return {
    kind: 'starter',
    description: '',
    category: 'Meetings',
    icon: { type: 'emoji', emoji: '📝' },
    by: 'Care Hub',
    contents: { subPages: 0, databases: 0, sampleRows: 0 },
    audience: { type: 'everyone' },
    hidden: false,
    canManage: false,
    ...fields,
  };
}

export const CARDS: TemplateCard[] = [
  card({
    id: LAUNCH_ID,
    kind: 'workspace',
    name: 'Launch plan',
    description: 'A launch with its agenda and tickets.',
    category: 'Projects',
    by: 'Sam Ortiz',
    icon: { type: 'emoji', emoji: '🚀' },
    contents: { subPages: 1, databases: 1, sampleRows: 6 },
    canManage: true,
  }),
  card({
    id: 'meeting-notes',
    name: 'Meeting notes',
    description: 'Agenda, notes and action items for any meeting.',
  }),
  card({
    id: 'weekly-huddle',
    name: 'Weekly huddle',
    description: 'Wins, numbers, blockers and shout-outs for the weekly check-in.',
  }),
  card({
    id: 'incident-review',
    name: 'Incident review',
    description: 'What happened, the timeline and what we’ll change.',
    category: 'Support',
    icon: { type: 'emoji', emoji: '🧯' },
  }),
];

export const SUPPORT_SPACE_ID = '3e9a1c55-8b2d-4f70-9c1e-5a4b3c2d1e0f';

export const GALLERY: GalleryResponse = {
  templates: CARDS,
  categories: ['Made in this workspace', 'Meetings', 'Projects', 'Knowledge', 'Team', 'Support'],
  canSave: true,
  spaces: [{ id: SUPPORT_SPACE_ID, name: 'Support' }],
};

export function previewOf(id: string): TemplatePreviewResponse {
  const template = CARDS.find((item) => item.id === id) ?? CARDS[1]!;
  if (id !== LAUNCH_ID) {
    return {
      template,
      pages: [{ key: 0, parentKey: null, kind: 'page', title: template.name, icon: template.icon }],
      markdown: '## Agenda\n\n1. Queue health\n2. Open questions\n\n- [ ] Share the notes\n',
    };
  }
  return {
    template,
    pages: [
      { key: 0, parentKey: null, kind: 'page', title: 'Q4 launch', icon: null },
      { key: 1, parentKey: 0, kind: 'page', title: 'Agenda', icon: null },
      { key: 2, parentKey: 0, kind: 'database', title: 'Tickets', icon: null },
    ],
    markdown: '## Goals\n\nCut the first reply time on chat.\n',
  };
}

/** A TemplatesClient whose calls are spies; pass changes to make one fail or answer otherwise. */
export function fakeClient(changes: Partial<TemplatesClient> = {}) {
  return {
    gallery: vi.fn(async () => GALLERY),
    preview: vi.fn(async (id: string) => previewOf(id)),
    copy: vi.fn(async () => ({ pageId: NEW_PAGE_ID, notCopied: [] as string[] })),
    setHidden: vi.fn(async () => undefined),
    save: vi.fn(async (input: SaveTemplateInput) =>
      card({
        id: NEW_TEMPLATE_ID,
        kind: 'workspace',
        name: input.name,
        category: input.category,
        by: 'Sam Ortiz',
        canManage: true,
      }),
    ),
    update: vi.fn(async (id: string, input: UpdateTemplateInput) => ({
      ...(CARDS.find((item) => item.id === id) ?? CARDS[0]!),
      ...input,
    })),
    remove: vi.fn(async () => undefined),
    ...changes,
  } satisfies TemplatesClient;
}

// jsdom has no ResizeObserver; Radix controls in the dialogs measure themselves.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

/** Renders `ui` at `/templates` (or `url`), with the page a copy opens at /p/:id. */
export function renderAt(
  ui: ReactElement,
  {
    client = fakeClient(),
    url = '/templates',
    state,
  }: {
    client?: TemplatesClient;
    url?: string;
    state?: unknown;
  } = {},
) {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  const [pathname = '/templates', search = ''] = url.split('?');
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ToastProvider>
      <QueryClientProvider client={queryClient}>
        <TemplatesClientProvider value={client}>
          <MemoryRouter initialEntries={[{ pathname, search: search ? `?${search}` : '', state }]}>
            <Routes>
              <Route path="/templates" element={ui} />
              <Route path="/p/:pageId" element={<p>The new page</p>} />
            </Routes>
          </MemoryRouter>
        </TemplatesClientProvider>
      </QueryClientProvider>
    </ToastProvider>,
  );
  return { client, queryClient };
}
