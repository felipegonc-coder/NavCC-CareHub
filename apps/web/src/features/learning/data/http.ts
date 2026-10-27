import { ApiErrorBodySchema, errorForStatus, type ApiIssue } from '@carehub/learning';

// The client every Learning screen uses for /api/learning/* (docs/learning/api.md). Each area writes its own calls
// and TanStack Query hooks with `api`, in its own folder, with the zod schemas from its `<module>/api.ts`.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Anything with zod's `parse`: the reply's schema, or `noContent` for replies without a body. */
export type ReplySchema<T> = { parse(data: unknown): T };

export type ApiOptions = { signal?: AbortSignal };

export const LEARNING_API = '/api/learning';
const CSRF_COOKIE = 'carehub_csrf';
const CSRF_HEADER = 'X-CSRF-Token';

/** For replies without a body, such as a 204 after a delete. */
export const noContent: ReplySchema<void> = { parse: () => undefined };

/**
 * A Learning API call that failed: the server's code, plain message and issues. `status` is 0 when the server
 * couldn't be reached (`offline`): keep the person's work and try again later.
 */
export class LearningApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiIssue[];

  constructor(status: number, code: string, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = 'LearningApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }

  get offline(): boolean {
    return this.status === 0;
  }
}

const OFFLINE = "Can't reach Care Hub. Check your connection, then try again.";
const UNREADABLE = "Care Hub sent a reply this page can't read. Reload the page, then try again.";

const isReplySchema = (value: unknown): value is ReplySchema<unknown> =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'parse') === 'function';

/**
 * Calls the Learning API and checks the reply with `schema`, e.g. `api('GET', '/catalog', CatalogSchema)` or
 * `api('POST', '/studio/courses', { type: 'standard' }, CreatedSchema)`. Sends the session cookie and, for
 * changes, the CSRF header. Throws `LearningApiError`; an aborted call rejects with the abort reason.
 */
export function api<T>(
  method: HttpMethod,
  path: string,
  schema: ReplySchema<T>,
  options?: ApiOptions,
): Promise<T>;
export function api<T>(
  method: HttpMethod,
  path: string,
  body: unknown,
  schema: ReplySchema<T>,
  options?: ApiOptions,
): Promise<T>;
export async function api<T>(
  method: HttpMethod,
  path: string,
  bodyOrSchema: unknown,
  schemaOrOptions?: ReplySchema<T> | ApiOptions,
  lastOptions?: ApiOptions,
): Promise<T> {
  const hasBody = isReplySchema(schemaOrOptions);
  const body = hasBody ? bodyOrSchema : undefined;
  const schema = (hasBody ? schemaOrOptions : bodyOrSchema) as ReplySchema<T>;
  const options = (hasBody ? lastOptions : schemaOrOptions) as ApiOptions | undefined;
  if (!path.startsWith('/')) throw new TypeError(`Learning API paths start with "/": ${path}`);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = method === 'GET' ? undefined : readCookie(CSRF_COOKIE);
  if (csrf) headers[CSRF_HEADER] = csrf;

  let response: Response;
  try {
    response = await fetch(LEARNING_API + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: options?.signal,
    });
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new LearningApiError(0, 'offline', OFFLINE);
  }
  if (!response.ok) throw await errorFrom(response);
  try {
    return schema.parse(response.status === 204 ? undefined : await response.json());
  } catch (error) {
    if (options?.signal?.aborted) throw error;
    throw new LearningApiError(response.status, 'unreadable_reply', UNREADABLE);
  }
}

/** Adds the set values to a path as a query string: `withQuery('/catalog', { q: 'fire', topic: undefined })`. */
export function withQuery(
  path: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

async function errorFrom(response: Response): Promise<LearningApiError> {
  const parsed = ApiErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (parsed.success) {
    const { code, message, issues } = parsed.data.error;
    return new LearningApiError(response.status, code, message, issues);
  }
  const standard = errorForStatus(response.status);
  return new LearningApiError(response.status, standard.code, standard.message);
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key !== name) continue;
    const value = rest.join('=');
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}
