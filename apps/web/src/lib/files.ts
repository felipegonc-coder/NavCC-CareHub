import { CSRF_HEADER, readCsrfToken, uploadedFileSchema, type UploadedFile } from '@carehub/shared';
import { api, ApiError } from './api';

// Uploads to Care Hub's files (decision 0007, section 4.3).

export interface UploadProgress {
  /** Bytes sent so far. */
  loaded: number;
  /** Bytes to send in all (a little more than the file, with the form around it). */
  total: number;
}

export interface UploadFileOptions {
  /** Where the file goes: `<feature>:<id>`, for example `learning:<course id>`. */
  scope: string;
  /** Called while the file goes up. */
  onProgress?: (progress: UploadProgress) => void;
  /** Cancels the upload: the promise rejects with an AbortError and the server keeps nothing. */
  signal?: AbortSignal;
  /**
   * For a form anyone can fill in (a scope registered with `allowAnonymous: true`), signed in or not: no
   * one is recorded as the uploader, and Care Hub keeps the file only if the form is sent within an hour.
   */
  anonymous?: boolean;
}

const HEIC_TYPES = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);
const HEIC_ENDING = /\.(heic|heif)$/i;
const JPEG_QUALITY = 0.9;

const cancelled = () => new DOMException('The upload was cancelled.', 'AbortError');
const offline = () =>
  new ApiError(0, 'offline', "Can't reach Care Hub. Check your connection, then try again.");

// Used when an error answer has no `{ error: { code, message } }` body (decision 0007, section 2.2).
const CODES: Record<number, string> = {
  400: 'invalid',
  401: 'signed_out',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'too_large',
  429: 'rate_limited',
};

/**
 * Uploads a file and returns what Care Hub kept: its id, name, size, type and address (plus width and
 * height for pictures). A HEIC photo goes up as a JPEG when this browser can read it (Safari can); other
 * browsers send it as it is. Throws ApiError, for example `too_large` with the size and the limit.
 */
export async function uploadFile(
  file: File,
  { scope, onProgress, signal, anonymous = false }: UploadFileOptions,
): Promise<UploadedFile> {
  if (signal?.aborted) throw cancelled();
  const upload = isHeic(file) ? await heicAsJpeg(file) : file;
  if (signal?.aborted) throw cancelled();
  const form = new FormData();
  form.append('file', upload, upload.name);

  return new Promise<UploadedFile>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const route = anonymous ? '/api/files/anonymous' : '/api/files';
    request.open('POST', `${route}?scope=${encodeURIComponent(scope)}`);
    request.setRequestHeader('Accept', 'application/json');
    const token = readCsrfToken(document.cookie);
    if (token) request.setRequestHeader(CSRF_HEADER, decodeURIComponent(token));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.({ loaded: event.loaded, total: event.total });
    };
    request.onload = () => {
      try {
        resolve(answer(request.status, request.responseText));
      } catch (error) {
        reject(error);
      }
    };
    request.onerror = () => reject(offline());
    request.ontimeout = () => reject(offline());
    request.onabort = () => reject(cancelled());
    request.onloadend = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
    request.send(form);
  });
}

/** The uploaded file from Care Hub's answer, or the ApiError it describes. */
function answer(status: number, text: string): UploadedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (status < 200 || status > 299) {
    type ErrorBody = { error?: { code?: unknown; message?: unknown; details?: unknown } };
    const { error } = (data ?? {}) as ErrorBody;
    throw new ApiError(
      status,
      typeof error?.code === 'string' ? error.code : (CODES[status] ?? 'unexpected'),
      typeof error?.message === 'string' ? error.message : 'Something went wrong. Try again.',
      error?.details,
    );
  }
  const parsed = uploadedFileSchema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(
      status,
      'invalid_response',
      'Care Hub sent something unexpected. Try again.',
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/**
 * Copies a picture from another website into Care Hub (POST /api/files/from-url), for example one pasted
 * into a page. Only pictures of up to 10 MB on public websites are copied: anything else throws an
 * ApiError saying why, and the caller keeps the link instead.
 */
export function copyPictureFromUrl(
  url: string,
  { scope, signal }: { scope: string; signal?: AbortSignal },
): Promise<UploadedFile> {
  return api.post('/api/files/from-url', { url, scope }, { schema: uploadedFileSchema, signal });
}

/** Whether a file is a HEIC or HEIF photo (some browsers give no type, so the ending counts too). */
export function isHeic(file: File): boolean {
  return HEIC_TYPES.has(file.type.toLowerCase()) || (!file.type && HEIC_ENDING.test(file.name));
}

/**
 * The photo as a JPEG, when this browser can read HEIC; otherwise the file as it is (Care Hub keeps it as
 * HEIC, with its location removed). Drawing it again also leaves the camera details behind.
 */
export async function heicAsJpeg(file: File): Promise<File> {
  try {
    const picture = await createImageBitmap(file);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = picture.width;
      canvas.height = picture.height;
      const context = canvas.getContext('2d');
      if (!context) return file;
      context.drawImage(picture, 0, 0);
      const jpeg = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
      );
      if (!jpeg || jpeg.type !== 'image/jpeg') return file;
      const name = `${file.name.replace(HEIC_ENDING, '') || 'photo'}.jpg`;
      return new File([jpeg], name, { type: 'image/jpeg', lastModified: file.lastModified });
    } finally {
      picture.close();
    }
  } catch {
    return file;
  }
}
