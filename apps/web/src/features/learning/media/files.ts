// Stand-in for `uploadFile` from core's apps/web/src/lib/files.ts (decision 0007 section 4.3, due Oct 28). It
// talks to core's files API itself: same name, options and answer, so switching over is one import line.

/** What an upload gives back: core's `POST /api/files` answer. */
export type UploadedFile = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  width?: number;
  height?: number;
};

export type UploadFileOptions = {
  /** Where the file belongs: `learning:<courseId>`. */
  scope: string;
  /** How much has been sent, from 0 to 1. */
  onProgress?: (fraction: number) => void;
  /** Stops the upload, which then fails with an `AbortError`. */
  signal?: AbortSignal;
};

/** A refused or failed upload, with the fields of core's `ApiError`. `status` is 0 when the connection failed. */
export class UploadError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
    this.code = code;
  }
}

const ENDPOINT = '/api/files';
/**
 * The readable CSRF cookie, sent back in the X-CSRF-Token header (decision 0007 section 3.1). Over HTTPS it has
 * the `__Host-` prefix. Until accounts 1b's `readCsrfToken()` lands, both names are read here.
 */
const CSRF_COOKIES = ['__Host-carehub_csrf', 'carehub_csrf'];
const FAILED = "The file couldn't be uploaded. Try again.";
const COPY_FAILED = "The picture couldn't be copied from that link. Download it, then upload it.";
const OFFLINE = 'The upload stopped. Check your connection and try again.';

function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const cookies = new Map<string, string>();
  for (const part of document.cookie.split(';')) {
    const [name = '', ...value] = part.trim().split('=');
    if (name) cookies.set(name, value.join('='));
  }
  for (const name of CSRF_COOKIES) {
    const value = cookies.get(name);
    if (value) return decodeURIComponent(value);
  }
  return undefined;
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isUploadedFile(value: unknown): value is UploadedFile {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.id === 'string' &&
    typeof file.name === 'string' &&
    typeof file.size === 'number' &&
    typeof file.mimeType === 'string' &&
    typeof file.url === 'string'
  );
}

function refusal(status: number, body: unknown, failed = FAILED): UploadError {
  const error = (body as { error?: { code?: unknown; message?: unknown } } | undefined)?.error;
  return new UploadError(
    status,
    typeof error?.code === 'string' ? error.code : 'server_error',
    typeof error?.message === 'string' ? error.message : failed,
  );
}

const succeeded = (status: number) => status >= 200 && status < 300;
const stopped = () => new DOMException('The upload was stopped.', 'AbortError');

/**
 * Uploads a file (multipart, field `file`), reporting progress. Fails with an `UploadError` carrying the
 * server's message (for example "This picture is 11 MB. Pictures can be at most 10 MB.").
 */
export function uploadFile(
  file: File,
  { scope, onProgress, signal }: UploadFileOptions,
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(stopped());
    const request = new XMLHttpRequest();
    const stop = () => request.abort();
    const settle = () => signal?.removeEventListener('abort', stop);
    request.open('POST', `${ENDPOINT}?scope=${encodeURIComponent(scope)}`);
    const token = csrfToken();
    if (token) request.setRequestHeader('X-CSRF-Token', token);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      settle();
      const body = readJson(request.responseText);
      if (!succeeded(request.status) || !isUploadedFile(body))
        return reject(refusal(request.status, body));
      onProgress?.(1);
      resolve(body);
    };
    request.onerror = () => {
      settle();
      reject(new UploadError(0, 'network', OFFLINE));
    };
    request.onabort = () => {
      settle();
      reject(stopped());
    };
    signal?.addEventListener('abort', stop, { once: true });
    const body = new FormData();
    body.append('file', file, file.name);
    request.send(body);
  });
}

/**
 * Copies a picture from a web link into the course's files (core's `POST /api/files/from-url`: pictures only,
 * up to 10 MB). Pictures from other sites can't be shown directly: the page only loads Care Hub's own.
 */
export async function uploadFromUrl(
  url: string,
  { scope, signal }: Pick<UploadFileOptions, 'scope' | 'signal'>,
): Promise<UploadedFile> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = csrfToken();
  if (token) headers['X-CSRF-Token'] = token;
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/from-url`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url, scope }),
      credentials: 'same-origin',
      signal,
    });
  } catch (caught) {
    if (signal?.aborted) throw stopped();
    throw caught instanceof DOMException && caught.name === 'AbortError'
      ? caught
      : new UploadError(0, 'network', OFFLINE);
  }
  const body = readJson(await response.text().catch(() => ''));
  if (response.status === 404) throw new UploadError(404, 'not_found', COPY_FAILED);
  if (!succeeded(response.status) || !isUploadedFile(body))
    throw refusal(response.status, body, COPY_FAILED);
  return body;
}
