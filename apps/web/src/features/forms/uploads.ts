/**
 * Uploads for file questions through the files API (decision 0007: `POST /api/files`, multipart
 * field `file`, query `scope=<feature>:<id>`), with progress. A stand-in for `uploadFile` from
 * apps/web/src/lib/files.ts until it lands. Forms anyone can fill in upload signed out to the scope
 * `forms:<formId>` and take only the file types the security conditions in decision 0200 allow.
 */
import type { FileRef } from '@carehub/databases';
import { ApiError, OFFLINE_MESSAGE, UNKNOWN_ERROR_MESSAGE } from '../databases/api';

/** What `POST /api/files` answers. */
export interface UploadedFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  url: string;
  width?: number;
  height?: number;
}

export interface UploadOptions {
  /** `forms:<formId>` for file questions. */
  scope: string;
  /** Called with 0 to 1 as the file goes up. */
  onProgress?: (fraction: number) => void;
}

/** The files scope a form's uploads belong to. */
export function formUploadScope(formId: string): string {
  return `forms:${formId}`;
}

/** The value a file question keeps for an uploaded file. */
export function toFileRef(file: UploadedFile): FileRef {
  return { id: file.id, name: file.name, size: file.size, mime: file.mimeType };
}

/**
 * File types a form anyone can fill in takes: pictures, PDFs, and Word, Excel and PowerPoint files
 * as docx, xlsx and pptx only (no files with macros, no old binary formats). The server checks the
 * content too; this only keeps the file picker honest.
 */
export const PUBLIC_UPLOAD_EXTENSIONS = [
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
] as const;

/** The file picker's `accept` for forms anyone can fill in. */
export const PUBLIC_UPLOAD_ACCEPT = PUBLIC_UPLOAD_EXTENSIONS.join(',');

/** Shown when someone picks a file a form anyone can fill in doesn't take. */
export const PUBLIC_UPLOAD_REFUSED =
  'This form takes pictures, PDFs, and Word, Excel or PowerPoint files (.docx, .xlsx, .pptx).';

/** Whether a form anyone can fill in takes this file, by its name. */
export function isPublicUploadAllowed(file: Pick<File, 'name'>): boolean {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot < 0) return false;
  return (PUBLIC_UPLOAD_EXTENSIONS as readonly string[]).includes(name.slice(dot));
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function isUploadedFile(v: unknown): v is UploadedFile {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.size === 'number' &&
    typeof v.mimeType === 'string'
  );
}

function parseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function uploadError(status: number, body: unknown): ApiError {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const code = typeof error?.code === 'string' ? error.code : 'unknown';
  const message = typeof error?.message === 'string' ? error.message : UNKNOWN_ERROR_MESSAGE;
  return new ApiError(status, code, message);
}

/**
 * Sends one file to the files API and resolves to what it saved, or rejects with an ApiError
 * carrying the server's message ("Too many uploads", "This file type isn't allowed" and so on).
 * Uses XMLHttpRequest because fetch can't report upload progress.
 */
export function uploadWithProgress(file: File, options: UploadOptions): Promise<UploadedFile> {
  return new Promise<UploadedFile>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/files?scope=${encodeURIComponent(options.scope)}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0)
        options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      const body = parseJson(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && isUploadedFile(body)) resolve(body);
      else reject(uploadError(xhr.status, body));
    };
    xhr.onerror = () => reject(new ApiError(0, 'offline', OFFLINE_MESSAGE));
    const data = new FormData();
    data.append('file', file);
    xhr.send(data);
  });
}
