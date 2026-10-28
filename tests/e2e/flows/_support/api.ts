import type { APIResponse, Page } from '@playwright/test';
import { test } from './test.js';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** The CSRF cookie: plain over HTTP, with the __Host- prefix when cookies are Secure (0007, 3.1). */
const CSRF_COOKIES: ReadonlySet<string> = new Set(['carehub_csrf', '__Host-carehub_csrf']);

/** The CSRF token of the person signed in on `page`, for the X-CSRF-Token header. */
export async function csrfTokenOf(page: Page): Promise<string> {
  const baseURL = test.info().project.use.baseURL ?? '';
  const cookies = await page.context().cookies(baseURL || undefined);
  return cookies.find((cookie) => CSRF_COOKIES.has(cookie.name))?.value ?? '';
}

/**
 * Calls the Care Hub API as the person signed in on `page`. It shares the page's cookies and sends
 * the CSRF header and Origin that state-changing requests need (docs/decisions/0007, section 3.1).
 * Use it to make a test's own data quickly, and to check that the server refuses a request
 * (403) that the screens hide. Check what people see through the screens, not through the API.
 */
export async function apiFor(page: Page) {
  const baseURL = test.info().project.use.baseURL ?? '';
  const headers = { 'X-CSRF-Token': await csrfTokenOf(page), Origin: new URL(baseURL).origin };

  /** The raw response, for checks on the status code (for example 403 or 404). */
  const send = (method: Method, path: string, data?: unknown): Promise<APIResponse> =>
    page.request.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) });

  /** The parsed JSON body; throws with the status and the error message when it isn't 2xx. */
  const json = async <T = unknown>(method: Method, path: string, data?: unknown): Promise<T> => {
    const response = await send(method, path, data);
    if (!response.ok()) {
      throw new Error(`${method} ${path} answered ${response.status()}: ${await response.text()}`);
    }
    return (response.status() === 204 ? undefined : await response.json()) as T;
  };

  return {
    send,
    get: <T = unknown>(path: string) => json<T>('GET', path),
    post: <T = unknown>(path: string, data?: unknown) => json<T>('POST', path, data),
    put: <T = unknown>(path: string, data?: unknown) => json<T>('PUT', path, data),
    patch: <T = unknown>(path: string, data?: unknown) => json<T>('PATCH', path, data),
    delete: <T = unknown>(path: string) => json<T>('DELETE', path),
  };
}
