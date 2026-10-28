import { ApiErrorBodySchema, errorForStatus, type ApiIssue } from '@carehub/learning';
import { CSRF_COOKIE, CSRF_HEADER } from '@carehub/shared';

// The client every Learning screen uses for /api/learning/* (docs/learning/api.md). Each area writes its own calls
// and TanStack Query hooks with `api`, in its own folder, with the zod schemas from its `<module>/api.ts`.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Anything with zod's `parse`: the reply's schema, or `noContent` for replies without a body. */
export type ReplySchema<T> = { parse(data: unknown): T };

/** `headers` go out with the call, such as a review's `X-Review-Token`; the client's own headers win. */
export type ApiOptions = { signal?: AbortSignal; headers?: Readonly<Record<string, string>> };

export const LEARNING_API = '/api/learning';
// Core's CSRF cookie and header names come from @carehub/shared; over HTTPS the cookie gets the `__Host-` prefix
// (0007 section 3.1). S1's readCsrfToken() replaces this lookup once it's on main.
const CSRF_COOKIES = [`__Host-${CSRF_COOKIE}`, CSRF_COOKIE] as const;

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
 * changes, the CSRF header. Throws `LearningApiError`; an aborted call rejects with the abort reason. Paths with
 * ids come from `apiPath`; a path with a `.` or `..` part, even encoded, is refused with a `TypeError`.
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
  checkPath(path);

  const headers: Record<string, string> = { ...options?.headers, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf =
    method === 'GET' || typeof document === 'undefined'
      ? undefined
      : csrfTokenFrom(document.cookie);
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

/**
 * A Learning API path from its parts, each one encoded: `apiPath('studio', 'courses', courseId, 'publish')`. Build
 * every path that holds an id this way (0310). A part can't be empty, `.` or `..` (also written `%2e`), or hold `/`
 * or `\`, so an id from a link can never point the call at another endpoint.
 */
export function apiPath(...parts: readonly (string | number)[]): string {
  if (parts.length === 0) throw new TypeError(UNSAFE);
  return parts
    .map((part) => {
      const text = String(part);
      const plain = decoded(text);
      if (unsafePart(text) || (plain !== undefined && unsafePart(plain)))
        throw new TypeError(UNSAFE);
      return `/${encodeURIComponent(text)}`;
    })
    .join('');
}

const UNSAFE = 'Not a safe Learning API path.';

const unsafePart = (part: string): boolean =>
  part === '' || part === '.' || part === '..' || /[/\\]/.test(part);

function decoded(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/**
 * `api` takes `/`, encoded parts, then an optional query. Browsers read `%2e` as a dot, so encoded dots are refused
 * too, and so are fragments, backslashes and parts that don't decode.
 */
function checkPath(path: string): void {
  if (!path.startsWith('/')) throw new TypeError(`Learning API paths start with "/": ${path}`);
  if (/[#\\]/.test(path)) throw new TypeError(UNSAFE);
  const pathname = path.split('?', 1)[0] ?? '';
  for (const part of pathname.slice(1).split('/')) {
    const plain = decoded(part);
    if (plain === undefined || unsafePart(part) || unsafePart(plain)) throw new TypeError(UNSAFE);
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

/**
 * The CSRF token in a `document.cookie` string. The HTTPS name wins: a page can only see that cookie over HTTPS,
 * where it's the one the server checks.
 */
export function csrfTokenFrom(cookies: string): string | undefined {
  for (const name of CSRF_COOKIES) {
    const value = cookieValue(cookies, name);
    if (value) return value;
  }
  return undefined;
}

function cookieValue(cookies: string, name: string): string | undefined {
  for (const part of cookies.split(';')) {
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
