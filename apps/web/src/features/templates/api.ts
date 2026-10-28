// The gallery's calls to /api/templates (apps/server/src/features/templates/README.md). Screens
// get the client from context, so tests can pass a fake one (test-utils.tsx).
import type {
  GalleryResponse,
  TemplatePreviewResponse,
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
