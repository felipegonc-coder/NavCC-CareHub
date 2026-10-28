import { z } from 'zod';
import { idSchema } from './compose';
import { ATTACHMENTS_MAX, DESCRIPTION_MAX_LENGTH } from './constants';
import { collapseWhitespace, countCharacters, isBlankText, normalizeMessageText } from './text';
import type { AttachmentKind } from './types';

export const ATTACHMENT_KINDS = [
  'picture',
  'video',
  'audio',
  'pdf',
  'file',
] as const satisfies readonly AttachmentKind[];

const PICTURE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);
/** HEIC pictures are turned into JPEG when they're uploaded. */
const CONVERTED_TO_JPEG: ReadonlySet<string> = new Set(['image/heic', 'image/heif']);
const VIDEO_TYPES: ReadonlySet<string> = new Set(['video/mp4', 'video/webm']);
/** MP3, M4A, WAV and OGG, under the names browsers give them. */
const AUDIO_TYPES: ReadonlySet<string> = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/vnd.wave',
  'audio/ogg',
]);

/** "image/JPEG; foo=bar" → "image/jpeg". */
export function mimeEssence(type: string): string {
  return (type.split(';')[0] ?? '').trim().toLowerCase();
}

/** How a file shows in a message: picture thumbnail, player, PDF or file card. */
export function attachmentKind(type: string): AttachmentKind {
  const essence = mimeEssence(type);
  if (PICTURE_TYPES.has(essence) || CONVERTED_TO_JPEG.has(essence)) return 'picture';
  if (VIDEO_TYPES.has(essence)) return 'video';
  if (AUDIO_TYPES.has(essence)) return 'audio';
  return essence === 'application/pdf' ? 'pdf' : 'file';
}

/** What to store: HEIC and HEIF pictures become JPEG ("IMG_0001.HEIC" → "IMG_0001.jpg"). */
export function storedFile(file: { name: string; type: string }): {
  name: string;
  type: string;
  convertToJpeg: boolean;
} {
  const type = mimeEssence(file.type);
  if (!CONVERTED_TO_JPEG.has(type)) return { name: file.name, type, convertToJpeg: false };
  return {
    name: `${file.name.replace(/\.hei[cf]$/iu, '')}.jpg`,
    type: 'image/jpeg',
    convertToJpeg: true,
  };
}

const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069]/gu;
const FILE_NAME_MAX = 255;

/** A file name safe to show and to send in headers: no folders, control or direction characters. */
export function cleanFileName(raw: string): string {
  const base = raw.split(/[/\\]/u).at(-1) ?? '';
  const name = collapseWhitespace(
    base
      .normalize('NFC')
      .replace(/\p{Cc}/gu, ' ')
      .replace(BIDI_CONTROLS, ''),
  );
  if (!name || name === '.' || name === '..') return 'file';
  if (countCharacters(name) <= FILE_NAME_MAX) return name;
  const extension = /\.[\p{L}\p{N}]{1,10}$/u.exec(name)?.[0] ?? '';
  const stem = [...name.slice(0, name.length - extension.length)].slice(
    0,
    FILE_NAME_MAX - extension.length,
  );
  return `${stem.join('').trimEnd()}${extension}`;
}

/** The workspace's upload types and sizes (Phase 1, Data settings spec), from the uploads feature. */
export interface UploadRules {
  /** The largest allowed size for a type, in bytes, or null when the type isn't allowed. */
  maxBytesFor(type: string): number | null;
}

export type FileProblem = 'too-many-files' | 'too-large' | 'type-not-allowed';

export interface PickedFile {
  name: string;
  type: string;
  size: number;
}

/** Checks one file against the upload rules (the server does this for every upload). */
export function fileProblem(file: PickedFile, rules: UploadRules): FileProblem | null {
  const max = rules.maxBytesFor(mimeEssence(file.type));
  if (max === null) return 'type-not-allowed';
  return file.size > max ? 'too-large' : null;
}

/** Files attached, pasted or dropped into the composer: which can go (up to 10), and why not. */
export function checkNewFiles<T extends PickedFile>(
  files: readonly T[],
  rules: UploadRules,
  alreadyAttached = 0,
): { accepted: T[]; rejected: { file: T; problem: FileProblem }[] } {
  const accepted: T[] = [];
  const rejected: { file: T; problem: FileProblem }[] = [];
  for (const file of files) {
    let problem = fileProblem(file, rules);
    if (!problem && alreadyAttached + accepted.length >= ATTACHMENTS_MAX)
      problem = 'too-many-files';
    if (problem) rejected.push({ file, problem });
    else accepted.push(file);
  }
  return { accepted, rejected };
}

/** An edit can remove files but not add them. Kept files stay in their order. */
export function checkKeptAttachments(
  currentIds: readonly string[],
  keepIds: readonly string[],
): { ok: true; keepIds: string[]; removeIds: string[] } | { ok: false; error: 'cannot-add-files' } {
  const current = new Set(currentIds);
  const keep = new Set(keepIds);
  if ([...keep].some((id) => !current.has(id))) return { ok: false, error: 'cannot-add-files' };
  return {
    ok: true,
    keepIds: currentIds.filter((id) => keep.has(id)),
    removeIds: currentIds.filter((id) => !keep.has(id)),
  };
}

/** Pictures show in the grid, video and audio play in the message, other files show as cards. */
export function splitAttachments<T extends { kind: AttachmentKind }>(attachments: readonly T[]) {
  return {
    pictures: attachments.filter((file) => file.kind === 'picture'),
    media: attachments.filter((file) => file.kind === 'video' || file.kind === 'audio'),
    files: attachments.filter((file) => file.kind === 'pdf' || file.kind === 'file'),
  };
}

export const PICTURE_GRID_MAX = 4;

/** One picture shows large, 2–4 in a grid; more show "+3" on the last tile. */
export function pictureGrid<T>(pictures: readonly T[]): {
  layout: 'none' | 'single' | 'grid';
  shown: T[];
  more: number;
  moreLabel: string | null;
} {
  const shown = pictures.slice(0, PICTURE_GRID_MAX);
  const more = pictures.length - shown.length;
  const layout = pictures.length === 0 ? 'none' : pictures.length === 1 ? 'single' : 'grid';
  return { layout, shown, more, moreLabel: more > 0 ? `+${more}` : null };
}

/**
 * A picture's description for screen readers: one line; blank means none. The sender adds it
 * before sending or later (check with `checkChangeMessage`).
 */
export function normalizeDescription(
  raw: string | null | undefined,
): { ok: true; description: string | null } | { ok: false; error: 'too-long' } {
  const description = collapseWhitespace(normalizeMessageText(raw ?? ''));
  if (isBlankText(description)) return { ok: true, description: null };
  if (countCharacters(description) > DESCRIPTION_MAX_LENGTH)
    return { ok: false, error: 'too-long' };
  return { ok: true, description };
}

export const describePictureBodySchema = z.object({
  description: z
    .string()
    .max(DESCRIPTION_MAX_LENGTH * 4)
    .nullable(),
});

/** A file in a message, as viewers get it. Downloads go through a members-only route by `id`. */
export const attachmentSchema = z.object({
  id: idSchema,
  kind: z.enum(ATTACHMENT_KINDS),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  description: z.string().nullable(),
});
export type Attachment = z.infer<typeof attachmentSchema>;

const SIZE_UNITS = ['KB', 'MB', 'GB', 'TB'] as const;

/** "820 bytes", "2.4 MB", "15 MB" (1 KB = 1,024 bytes). */
export function formatFileSize(bytes: number): string {
  const whole = Math.max(0, Math.round(bytes));
  if (whole < 1024) return whole === 1 ? '1 byte' : `${whole} bytes`;
  let value = whole / 1024;
  let unit = 0;
  while (unit < SIZE_UNITS.length - 1 && Math.round(value) >= 1024) {
    value /= 1024;
    unit += 1;
  }
  const shown = value < 9.95 ? value.toFixed(1).replace(/\.0$/u, '') : String(Math.round(value));
  return `${shown} ${SIZE_UNITS[unit] ?? 'TB'}`;
}
