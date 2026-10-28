import type {
  ImportView,
  StartImportInput,
  UndoPreview,
} from '@carehub/extras/import-export/import/index';
import { ApiError, api } from '../../../lib/api';
import { TOO_BIG } from './prepare';

// The import routes (/api/import-export/imports, docs/extras/import-export.md) as the Import screen
// and the progress panel call them. Only the person who started an import sees it.

const IMPORTS = '/api/import-export/imports';

interface ImportResponse {
  import: ImportView;
}

/** The CSRF token from its cookie, as lib/api sends it. */
function csrfToken(): string | undefined {
  const value = /(?:^|;\s*)carehub_csrf=([^;]*)/.exec(document.cookie)?.[1];
  return value ? decodeURIComponent(value) : undefined;
}

/**
 * Sends the file as the raw body (lib/api sends JSON only), with the same errors as lib/api.
 * stand-in: lib/api's upload call, once it has one.
 */
async function sendFile(id: string, body: Blob, signal?: AbortSignal): Promise<ImportView> {
  const headers = new Headers({
    Accept: 'application/json',
    'Content-Type': 'application/octet-stream',
  });
  const token = csrfToken();
  if (token) headers.set('X-CSRF-Token', token);
  let response: Response;
  try {
    response = await fetch(`${IMPORTS}/${encodeURIComponent(id)}/file`, {
      method: 'PUT',
      headers,
      body,
      credentials: 'same-origin',
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(
      0,
      'offline',
      "Can't reach Care Hub. Check your connection, then try again.",
    );
  }
  const data: unknown = await response.json().catch(() => undefined);
  if (response.status === 413) throw new ApiError(413, 'too_large', TOO_BIG);
  if (!response.ok) {
    const { error } = (data ?? {}) as { error?: { code?: unknown; message?: unknown } };
    throw new ApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'unexpected',
      typeof error?.message === 'string' ? error.message : 'Something went wrong. Try again.',
    );
  }
  return (data as ImportResponse).import;
}

const path = (id: string, end = '') => `${IMPORTS}/${encodeURIComponent(id)}${end}`;

export const importsApi = {
  /** The person's imports of the last 7 days, newest first, without their problems. */
  list: async (signal?: AbortSignal) =>
    (await api.get<{ imports: ImportView[] }>(IMPORTS, { signal })).imports,
  /** Starts an import; it waits for its file (status uploading). */
  start: async (input: StartImportInput) => (await api.post<ImportResponse>(IMPORTS, input)).import,
  /** The file, or the plan the screen made; then the import waits in line. */
  send: sendFile,
  get: async (id: string, signal?: AbortSignal) =>
    (await api.get<ImportResponse>(path(id), { signal })).import,
  /** Stops it; what it added is removed. */
  cancel: async (id: string) => (await api.post<ImportResponse>(path(id, '/cancel'))).import,
  /** What Undo import will move to Trash, pages changed since first. */
  undoPreview: async (id: string) =>
    (await api.get<{ preview: UndoPreview }>(path(id, '/undo'))).preview,
  undo: async (id: string, removeChanged: boolean) =>
    (await api.post<ImportResponse>(path(id, '/undo'), { removeChanged })).import,
};
