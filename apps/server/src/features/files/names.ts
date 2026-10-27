// File names as people gave them, made safe to keep and to send back in a header.
import { fileEnding } from './detect';

/** Control characters, and the invisible ones that reorder text (they can disguise an ending). */
const UNSAFE = /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu;
const MAX_LENGTH = 255;
const MB = 1024 * 1024;

/**
 * The name to keep for an upload: without folders or unsafe characters, at most 255 characters (keeping
 * the ending), and "file" when nothing is left.
 */
export function cleanFileName(raw: string | undefined): string {
  const base = (raw ?? '').normalize('NFC').split(/[/\\]/).pop() ?? '';
  const name = base.replace(UNSAFE, '').trim();
  if (!name || name === '.' || name === '..') return 'file';
  const chars = [...name];
  if (chars.length <= MAX_LENGTH) return name;
  const dot = name.lastIndexOf('.');
  const ending = dot > 0 ? [...name.slice(dot)] : [];
  const kept = ending.length <= 16 ? ending : [];
  return (
    chars
      .slice(0, MAX_LENGTH - kept.length)
      .join('')
      .trimEnd() + kept.join('')
  );
}

/** `inline` or `attachment` with the name, for every browser (RFC 6266 and RFC 8187). */
export function contentDisposition(type: 'inline' | 'attachment', name: string): string {
  const fallback = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const formatMb = (mb: number) => String(Number(mb.toFixed(1)));

/**
 * "This file is 100.1 MB; the limit is 100 MB." (Data settings, DS-05). 1 MB is 1,048,576 bytes. A file
 * over the limit is never rounded down to it.
 */
export function tooLargeMessage(size: number, limitMb: number): string {
  const shown = Math.max(Math.round((size / MB) * 10) / 10, limitMb + 0.1);
  return `This file is ${formatMb(shown)} MB; the limit is ${formatMb(limitMb)} MB.`;
}

/** The endings each picture type may have; the first is added when a name has none of them. */
const PICTURE_ENDINGS: Readonly<Record<string, readonly string[]>> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg', 'jpe', 'jfif'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'image/heic': ['heic'],
  'image/heif': ['heif', 'heic'],
  'image/svg+xml': ['svg'],
};

/** A picture's name, ending as its type does: "sunset" and "photo.php" as PNG become "sunset.png" and "photo.php.png". */
export function withPictureEnding(name: string, mimeType: string): string {
  const endings = PICTURE_ENDINGS[mimeType];
  if (!endings?.[0] || endings.includes(fileEnding(name))) return name;
  return cleanFileName(`${name}.${endings[0]}`);
}
