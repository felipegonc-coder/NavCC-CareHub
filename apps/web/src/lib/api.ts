import { readCsrfToken } from '@carehub/shared';
import type { z } from 'zod';

/** A failed API call. Status 0 with code 'offline' means Care Hub couldn't be reached. */
export class ApiError extends Error {
  override name = 'ApiError';
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Schema = z.ZodType | undefined;

export interface ApiOptions<S extends Schema = undefined> {
  /** Checks and types the response; a mismatch throws ApiError code 'invalid_response'. */
  schema?: S;
  signal?: AbortSignal;
}

/** The parsed body: the schema's output when one is given, else `T`. */
export type ApiResult<T, S extends Schema> = S extends z.ZodType ? z.output<S> : T;

// Used when an error response has no `{ error: { code, message } }` body (decision 0007, 2.2).
const CODES: Record<number, string> = {
  400: 'invalid',
  401: 'signed_out',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  429: 'rate_limited',
};

// `__Host-carehub_csrf` over HTTPS, `carehub_csrf` on a plain-HTTP development server. A value with
// broken percent-encoding is sent as it is.
function csrfToken(): string | undefined {
  const value = readCsrfToken(document.cookie);
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

async function request<T, S extends Schema>(
  method: string,
  path: string,
  body: unknown,
  { schema, signal }: ApiOptions<S> = {},
): Promise<ApiResult<T, S>> {
  const headers = new Headers({ Accept: 'application/json' });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  const token = method === 'GET' ? undefined : csrfToken();
  if (token) headers.set('X-CSRF-Token', token);

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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

  const data: unknown = response.headers.get('Content-Type')?.includes('json')
    ? await response.json().catch(() => undefined)
    : undefined;

  if (!response.ok) {
    type ErrorBody = { error?: { code?: unknown; message?: unknown; details?: unknown } };
    const { error } = (data ?? {}) as ErrorBody;
    throw new ApiError(
      response.status,
      typeof error?.code === 'string' ? error.code : (CODES[response.status] ?? 'unexpected'),
      typeof error?.message === 'string' ? error.message : 'Something went wrong. Try again.',
      error?.details,
    );
  }

  if (!schema) return data as ApiResult<T, S>;
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'invalid_response',
      'Care Hub sent something unexpected. Try again.',
      parsed.error.issues,
    );
  }
  return parsed.data as ApiResult<T, S>;
}

const withBody =
  (method: string) =>
  <T = unknown, S extends Schema = undefined>(
    path: string,
    body?: unknown,
    options?: ApiOptions<S>,
  ) =>
    request<T, S>(method, path, body, options);

/**
 * Calls the Care Hub API with the session cookie, JSON bodies and, on changes, the CSRF header.
 * Pass `schema` to check the response, or a type for an unchecked one. Throws ApiError.
 */
export const api = {
  get: <T = unknown, S extends Schema = undefined>(path: string, options?: ApiOptions<S>) =>
    request<T, S>('GET', path, undefined, options),
  post: withBody('POST'),
  put: withBody('PUT'),
  patch: withBody('PATCH'),
  delete: withBody('DELETE'),
};
