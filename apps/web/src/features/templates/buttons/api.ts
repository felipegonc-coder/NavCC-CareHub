// The "/button" block's calls to /api/templates/buttons (apps/server/src/features/templates/README.md).
// Blocks get the client from context, so tests can pass a fake one.
import type { DatabaseMeta } from '@carehub/databases';
import type {
  ButtonResponse,
  ButtonSettings,
  PressResponse,
  UndoResponse,
} from '@carehub/extras/templates/buttons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api } from '../../../lib/api';

const BASE = '/api/templates/buttons';
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;
const run = (runId: string, what: 'cancel' | 'undo') =>
  `${BASE}/runs/${encodeURIComponent(runId)}/${what}`;

/** A press, or Continue after a confirmation: the run and the step after the confirmation. */
export interface PressRequest {
  pageId: string;
  runId?: string;
  from?: number;
}

export const buttonsClient = {
  /** A new button on the page, with the default settings; its ID goes in the block. */
  create: (pageId: string) => api.post<ButtonResponse>(BASE, { pageId }),
  get: (id: string, pageId: string, signal?: AbortSignal) =>
    api.get<ButtonResponse>(`${one(id)}?${new URLSearchParams({ pageId })}`, { signal }),
  save: (id: string, pageId: string, settings: ButtonSettings) =>
    api.put<ButtonResponse>(one(id), { pageId, settings }),
  press: (id: string, body: PressRequest) => api.post<PressResponse>(`${one(id)}/press`, body),
  cancel: (runId: string) => api.post<{ undoUntil: string | null }>(run(runId, 'cancel')),
  undo: (runId: string) => api.post<UndoResponse>(run(runId, 'undo')),
  /** For Add a row and Edit rows: the database's properties and templates (Databases' GET). */
  database: (databaseId: string, signal?: AbortSignal) =>
    api.get<DatabaseMeta>(`/api/databases/${encodeURIComponent(databaseId)}`, { signal }),
};

export type ButtonsClient = typeof buttonsClient;

const ClientContext = createContext<ButtonsClient>(buttonsClient);
export const ButtonsClientProvider = ClientContext.Provider;
export const useButtonsClient = () => useContext(ClientContext);

export const buttonKeys = {
  one: (id: string, pageId: string) => ['templates', 'buttons', id, pageId] as const,
  database: (id: string) => ['templates', 'buttons', 'database', id] as const,
};

/** The settings, the sentence, whether this person may press it and, for editors, its runs. */
export function useButton(id: string, pageId: string) {
  const client = useButtonsClient();
  return useQuery({
    queryKey: buttonKeys.one(id, pageId),
    queryFn: ({ signal }) => client.get(id, pageId, signal),
    retry: false,
  });
}

export function useSaveButton(id: string, pageId: string) {
  const client = useButtonsClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: ButtonSettings) => client.save(id, pageId, settings),
    onSuccess: (button) => queryClient.setQueryData(buttonKeys.one(id, pageId), button),
  });
}

/** The database an Add a row or Edit rows step uses; nothing while none is chosen. */
export function useButtonDatabase(databaseId: string | null) {
  const client = useButtonsClient();
  return useQuery({
    queryKey: buttonKeys.database(databaseId ?? ''),
    queryFn: ({ signal }) => client.database(databaseId ?? '', signal),
    enabled: Boolean(databaseId),
    retry: false,
    staleTime: 60_000,
  });
}
