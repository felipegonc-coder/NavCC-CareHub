// The gallery's calls to /api/templates (apps/server/src/features/templates/README.md). Screens
// get the client from context, so tests can pass a fake one (test-utils.tsx).
import type { TemplateCard } from '@carehub/extras/templates/gallery';
import type {
  GalleryResponse,
  SaveTemplateInput,
  TemplatePreviewResponse,
  UpdateTemplateInput,
  UseTarget,
  UseTemplateResponse,
} from '@carehub/extras/templates/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext } from 'react';
import { api } from '../../lib/api';

const BASE = '/api/templates';
const path = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export interface UseTemplateRequest {
  target: UseTarget;
  includeSampleRows: boolean;
}

export const templatesClient = {
  gallery: (signal?: AbortSignal) => api.get<GalleryResponse>(BASE, { signal }),
  preview: (id: string, signal?: AbortSignal) =>
    api.get<TemplatePreviewResponse>(path(id), { signal }),
  /** Use template: the copy's top page, and databases that couldn't be copied yet. */
  copy: (id: string, body: UseTemplateRequest) =>
    api.post<UseTemplateResponse>(`${path(id)}/use`, body),
  /** Hide for everyone (Admins), or show it again. */
  setHidden: (id: string, hidden: boolean) =>
    hidden ? api.put<void>(`${path(id)}/hidden`) : api.delete<void>(`${path(id)}/hidden`),
  /** Save as template, from the page menu. */
  save: (input: SaveTemplateInput) => api.post<TemplateCard>(BASE, input),
  /** Rename, Change category, Who can use it. */
  update: (id: string, input: UpdateTemplateInput) => api.patch<TemplateCard>(path(id), input),
  /** Delete a workspace template; pages made from it stay. */
  remove: (id: string) => api.delete<void>(path(id)),
};

export type TemplatesClient = typeof templatesClient;

const ClientContext = createContext<TemplatesClient>(templatesClient);
export const TemplatesClientProvider = ClientContext.Provider;
export const useTemplatesClient = () => useContext(ClientContext);

export const templateKeys = {
  all: ['templates'] as const,
  gallery: ['templates', 'gallery'] as const,
  preview: (id: string) => ['templates', 'preview', id] as const,
};

/** The cards this person may see, the categories and whether they may save templates. */
export function useGallery() {
  const client = useTemplatesClient();
  return useQuery({
    queryKey: templateKeys.gallery,
    queryFn: ({ signal }) => client.gallery(signal),
    // The page menu reads `canSave` from here too, so one fetch serves both for a minute.
    staleTime: 60_000,
  });
}

/** One template's read-only preview; nothing is fetched while `id` is null. */
export function usePreview(id: string | null) {
  const client = useTemplatesClient();
  return useQuery({
    queryKey: templateKeys.preview(id ?? ''),
    queryFn: ({ signal }) => client.preview(id ?? '', signal),
    enabled: id !== null,
  });
}

/** Use template: the copy's top page and the databases that couldn't be copied yet. */
export function useTemplateCopy() {
  const client = useTemplatesClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UseTemplateRequest & { id: string }) => client.copy(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.gallery }),
  });
}

/** A mutation that refreshes the gallery (and its previews) when it's done. */
function useGalleryChange<Input, Output>(
  run: (client: TemplatesClient, input: Input) => Promise<Output>,
) {
  const client = useTemplatesClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Input) => run(client, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: templateKeys.all }),
  });
}

/** Save as template. */
export const useSaveTemplate = () =>
  useGalleryChange((client, input: SaveTemplateInput) => client.save(input));

/** Rename, Change category, Who can use it. */
export const useUpdateTemplate = () =>
  useGalleryChange((client, { id, input }: { id: string; input: UpdateTemplateInput }) =>
    client.update(id, input),
  );

/** Delete a workspace template. */
export const useDeleteTemplate = () => useGalleryChange((client, id: string) => client.remove(id));

/** Hide a starter for everyone, or show it again (Admins). */
export const useSetHidden = () =>
  useGalleryChange((client, { id, hidden }: { id: string; hidden: boolean }) =>
    client.setHidden(id, hidden),
  );
