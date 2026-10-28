// A simulated person's browser for the load test: it keeps the cookies the server sets and sends
// the CSRF header on writes, as the web app does, with Node's own fetch.

/** How long a request may take before it counts as a server error. */
export const TIMEOUT_MS = 10_000;

/**
 * @typedef {object} Answer
 * @property {number} status 0 when there was no answer (no connection, or too slow)
 * @property {number} ms from sending the request to the last byte of the answer
 * @property {unknown} body parsed JSON, the text of other text answers, or null
 * @property {number} bytes the body's size after decompression
 * @property {Headers} headers
 * @property {string | null} error why there was no answer
 */

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class Browser {
  /** @type {Map<string, string>} */
  #cookies = new Map();

  /**
   * @param {string} baseUrl
   * @param {{ timeoutMs?: number }} [options]
   */
  constructor(baseUrl, options = {}) {
    this.baseUrl = baseUrl;
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  }

  /** The CSRF cookie: carehub_csrf, or __Host-carehub_csrf with secure cookies. */
  csrf() {
    for (const [name, value] of this.#cookies) if (name.endsWith('carehub_csrf')) return value;
    return null;
  }

  /**
   * @param {string} method
   * @param {string} path
   * @param {{ json?: unknown, accept?: string }} [options]
   * @returns {Promise<Answer>}
   */
  async send(method, path, options = {}) {
    const headers = new Headers({ accept: options.accept ?? 'application/json' });
    if (this.#cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; '),
      );
    }
    const csrf = this.csrf();
    if (csrf && WRITES.has(method)) headers.set('x-csrf-token', csrf);
    let body;
    if (options.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.json);
    }
    const started = performance.now();
    try {
      const response = await fetch(new URL(path, this.baseUrl), {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.#keep(response.headers.getSetCookie());
      return {
        status: response.status,
        ms: performance.now() - started,
        body: parse(bytes, response.headers.get('content-type') ?? ''),
        bytes: bytes.byteLength,
        headers: response.headers,
        error: null,
      };
    } catch (error) {
      const ms = performance.now() - started;
      return {
        status: 0,
        ms,
        body: null,
        bytes: 0,
        headers: new Headers(),
        error: this.#why(error),
      };
    }
  }

  /** @param {string[]} lines Set-Cookie headers */
  #keep(lines) {
    for (const line of lines) {
      const [pair = '', ...attributes] = line.split(';');
      const at = pair.indexOf('=');
      if (at <= 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      const gone = attributes.some((attribute) => {
        const [key = '', ...rest] = attribute.split('=');
        const setting = rest.join('=').trim();
        if (key.trim().toLowerCase() === 'max-age') return Number(setting) <= 0;
        if (key.trim().toLowerCase() === 'expires') return Date.parse(setting) <= Date.now();
        return false;
      });
      if (gone || value === '') this.#cookies.delete(name);
      else this.#cookies.set(name, value);
    }
  }

  /** @param {unknown} error */
  #why(error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      return `no answer within ${this.timeoutMs / 1000} s`;
    }
    const cause = error instanceof Error ? error.cause : null;
    if (cause && typeof cause === 'object' && 'code' in cause) return String(cause.code);
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * @param {Uint8Array} bytes
 * @param {string} type the Content-Type
 * @returns {unknown}
 */
function parse(bytes, type) {
  if (!/json|text|html/.test(type)) return null;
  const text = new TextDecoder().decode(bytes);
  if (!type.includes('json')) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * ok: 2xx or 3xx; error: 5xx or no answer; failed: anything else (the server refused it).
 * @param {Answer} answer
 * @returns {import('./stats.mjs').Outcome}
 */
export function outcomeOf(answer) {
  if (answer.status >= 200 && answer.status < 400) return 'ok';
  return answer.status === 0 || answer.status >= 500 ? 'error' : 'failed';
}

/**
 * What went wrong, by route (like `GET /api/pages/:id`), so the report has no IDs in it.
 * @param {string} route
 * @param {Answer} answer
 */
export function problemOf(route, answer) {
  return answer.status === 0 ? `${route}: ${answer.error}` : `${route} answered ${answer.status}`;
}
