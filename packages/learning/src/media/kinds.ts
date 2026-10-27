import { LIMITS } from '../format/index';
import { byteAt, decodeUtf8, findAscii, hasAscii, u16be } from './bytes';
import { readImageSize } from './image-size';
import { parseWebVtt } from './webvtt';

/** What an uploaded file is used as. */
export const MEDIA_KINDS = ['image', 'video', 'audio', 'captions', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

const MB = 1024 * 1024;

/**
 * The largest upload per kind, in bytes. Core's files API takes up to 100 MB a file by default (`FILES_MAX_MB`,
 * decision 0007 section 4.3); Learning's limits are lower.
 */
export const MEDIA_SIZE_LIMITS: Readonly<Record<MediaKind, number>> = {
  image: 10 * MB,
  video: 50 * MB,
  audio: 25 * MB,
  captions: 1 * MB,
  document: 25 * MB,
};

/** The largest upload that may be any of `kinds`. */
export function sizeLimit(kinds: readonly MediaKind[]): number {
  return Math.max(...kinds.map((kind) => MEDIA_SIZE_LIMITS[kind]));
}

/** The largest upload of any kind. */
export const MAX_UPLOAD_BYTES = sizeLimit(MEDIA_KINDS);

/**
 * How much of a big file `checkUpload` needs: its first bytes (all of a captions file, and where a picture keeps
 * its size) and, as `end`, its last bytes (where zip and old Office files list what's inside).
 */
export const CHECK_HEAD_BYTES = 1 * MB;
export const CHECK_END_BYTES = 64 * 1024;

/** Pictures wider or taller than this are refused (too slow to show on phones). */
export const MAX_IMAGE_SIDE = 12_000;
/** Pictures with more pixels than this in total are refused. */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** How each kind is named in messages, and the file types it takes. */
export const MEDIA_KIND_INFO: Readonly<
  Record<MediaKind, { noun: string; formats: string; accept: string }>
> = {
  image: {
    noun: 'a picture',
    formats: 'PNG, JPEG, GIF or WebP',
    accept: 'image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp',
  },
  video: {
    noun: 'a video',
    formats: 'MP4, MOV or WebM',
    accept: 'video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm',
  },
  audio: {
    noun: 'an audio file',
    formats: 'MP3, M4A, AAC, WAV, OGG, FLAC or WebM',
    accept: 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac,.webm',
  },
  captions: { noun: 'a captions file', formats: 'WebVTT (.vtt)', accept: 'text/vtt,.vtt' },
  document: {
    noun: 'a document',
    formats: 'PDF, Word, Excel, PowerPoint, OpenDocument, RTF or plain text',
    accept: '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp,.rtf,.txt,.csv,.md',
  },
};

/** The `accept` attribute for a file input that takes these kinds. */
export function acceptAttribute(kinds: readonly MediaKind[]): string {
  return kinds.map((kind) => MEDIA_KIND_INFO[kind].accept).join(',');
}

/** A file type Care Hub takes. `kinds` are the uses it can serve, most likely first. */
export type FileType = {
  mime: string;
  extension: string;
  label: string;
  kinds: readonly MediaKind[];
};
export type SniffResult = { ok: true; type: FileType } | { ok: false; reason: string };

const type = (
  mime: string,
  extension: string,
  label: string,
  ...kinds: MediaKind[]
): SniffResult => ({
  ok: true,
  type: { mime, extension, label, kinds },
});
const refuse = (reason: string): SniffResult => ({ ok: false, reason });

const UNKNOWN = `Care Hub can't tell what kind of file this is. Upload a picture (${MEDIA_KIND_INFO.image.formats}), a video (${MEDIA_KIND_INFO.video.formats}), audio (${MEDIA_KIND_INFO.audio.formats}), captions (WebVTT) or a document (${MEDIA_KIND_INFO.document.formats}).`;
const VIDEO_BRANDS = /^(isom|iso[2-9]|mp4[12]|mp71|avc1|M4V[ HP]?|dash|mmp4|MSNV|3gp[4-6]|3g2a)$/;
const HEIF_BRANDS = /^(heic|heix|hevc|hevx|heim|heis|hevm|hevs|mif1|msf1|avif|avis)$/;

/**
 * Finds a file's type from its content, never from its name: `name` only picks between CSV, Markdown and plain
 * text once the content is known to be text. Refused files come back with a plain reason. For part of a file,
 * set `partial` and pass its last bytes as `end` (see `CHECK_HEAD_BYTES`).
 */
export function sniffFile(
  bytes: Uint8Array,
  name = '',
  options: { partial?: boolean; end?: Uint8Array } = {},
): SniffResult {
  const b = bytes;
  if (b.length === 0) return refuse('The file is empty.');
  if (hasAscii(b, '\x89PNG\r\n\x1a\n')) return type('image/png', 'png', 'PNG picture', 'image');
  if (byteAt(b, 0) === 0xff && byteAt(b, 1) === 0xd8 && byteAt(b, 2) === 0xff)
    return type('image/jpeg', 'jpg', 'JPEG picture', 'image');
  if (hasAscii(b, 'GIF87a') || hasAscii(b, 'GIF89a'))
    return type('image/gif', 'gif', 'GIF picture', 'image');
  if (hasAscii(b, 'RIFF')) {
    if (hasAscii(b, 'WEBP', 8)) return type('image/webp', 'webp', 'WebP picture', 'image');
    if (hasAscii(b, 'WAVE', 8)) return type('audio/wav', 'wav', 'WAV audio', 'audio');
    if (hasAscii(b, 'AVI ', 8))
      return refuse("AVI videos don't play in web browsers. Save it as MP4 and upload it again.");
  }
  if (hasAscii(b, 'ftyp', 4)) {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (HEIF_BRANDS.test(brand))
      return refuse(
        "HEIC and AVIF pictures don't show in every browser. Save it as JPEG or PNG and upload it again.",
      );
    if (/^M4[AB] $/.test(brand)) return type('audio/mp4', 'm4a', 'M4A audio', 'audio');
    // QuickTime files are served as MP4, which browsers play when the codecs inside are supported.
    if (brand === 'qt  ') return type('video/mp4', 'mov', 'QuickTime video', 'video', 'audio');
    if (VIDEO_BRANDS.test(brand)) return type('video/mp4', 'mp4', 'MP4 video', 'video', 'audio');
    return refuse(UNKNOWN);
  }
  if (hasAscii(b, '\x1a\x45\xdf\xa3')) {
    if (findAscii(b, 'webm', 4, 64) >= 0)
      return type('video/webm', 'webm', 'WebM video', 'video', 'audio');
    return refuse("MKV videos don't play in every browser. Save it as MP4 and upload it again.");
  }
  if (hasAscii(b, 'OggS')) {
    if (
      findAscii(b, 'OpusHead', 0, 128) >= 0 ||
      findAscii(b, 'vorbis', 0, 128) >= 0 ||
      findAscii(b, 'FLAC', 0, 128) >= 0
    ) {
      return type('audio/ogg', 'ogg', 'OGG audio', 'audio');
    }
    return refuse(
      "This OGG file isn't audio that browsers can play. Save it as MP4 or MP3 and upload it again.",
    );
  }
  if (hasAscii(b, 'fLaC')) return type('audio/flac', 'flac', 'FLAC audio', 'audio');
  if (hasAscii(b, 'ID3') || isMpegAudioFrame(b))
    return type('audio/mpeg', 'mp3', 'MP3 audio', 'audio');
  if (
    byteAt(b, 0) === 0xff &&
    (byteAt(b, 1) & 0xf6) === 0xf0 &&
    ((byteAt(b, 2) >> 2) & 0x0f) < 13
  ) {
    return type('audio/aac', 'aac', 'AAC audio', 'audio');
  }
  if (hasAscii(b, '%PDF-')) return type('application/pdf', 'pdf', 'PDF document', 'document');
  if (hasAscii(b, ZIP)) return sniffZip(withEnd(b, options.end));
  if (hasAscii(b, OLD_OFFICE)) return sniffOldOffice(withEnd(b, options.end));
  if (hasAscii(b, 'MZ') || hasAscii(b, '\x7fELF') || hasAscii(b, '#!') || isMachO(b)) {
    return refuse("Programs and scripts can't be uploaded.");
  }
  if (hasAscii(b, '{\\rtf')) return type('application/rtf', 'rtf', 'RTF document', 'document');
  return sniffText(options.partial ? withoutCutCharacter(b) : b, name);
}

const ZIP = 'PK\x03\x04';
const OLD_OFFICE = '\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1';

/** True for zip-based and old Office files: what's inside is listed at the end, so pass `end` for them. */
export const needsEnd = (bytes: Uint8Array): boolean =>
  hasAscii(bytes, ZIP) || hasAscii(bytes, OLD_OFFICE);

function withEnd(b: Uint8Array, end: Uint8Array | undefined): Uint8Array {
  if (!end || end.length === 0) return b;
  const both = new Uint8Array(b.length + end.length);
  both.set(b);
  both.set(end, b.length);
  return both;
}

/** The bytes without a UTF-8 character cut off at the end (when only the start of a file was passed). */
function withoutCutCharacter(b: Uint8Array): Uint8Array {
  for (let back = 1; back <= Math.min(4, b.length); back++) {
    const byte = byteAt(b, b.length - back);
    if ((byte & 0xc0) === 0x80) continue; // a continuation byte: keep looking for the first byte
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return length > back ? b.subarray(0, b.length - back) : b;
  }
  return b;
}

// MPEG-1/2/2.5 layer III frame header: sync bits, a real bitrate and a real sample rate.
function isMpegAudioFrame(b: Uint8Array): boolean {
  const bitrate = byteAt(b, 2) >> 4;
  const sampleRate = (byteAt(b, 2) >> 2) & 0x03;
  return (
    byteAt(b, 0) === 0xff &&
    [0xfb, 0xfa, 0xf3, 0xf2, 0xe3, 0xe2].includes(byteAt(b, 1)) &&
    bitrate > 0 &&
    bitrate < 15 &&
    sampleRate < 3
  );
}

function isMachO(b: Uint8Array): boolean {
  const head = u16be(b, 0) * 0x10000 + u16be(b, 2);
  return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(head);
}

const MACROS =
  "Documents with macros can't be uploaded. Save it without macros (as .docx, .xlsx or .pptx) and upload it again.";

function sniffZip(b: Uint8Array): SniffResult {
  if (hasAscii(b, 'mimetype', 30) && hasAscii(b, 'application/vnd.oasis.opendocument.', 38)) {
    const rest = String.fromCharCode(...b.subarray(73, 85));
    if (rest.startsWith('text'))
      return type(
        'application/vnd.oasis.opendocument.text',
        'odt',
        'OpenDocument text',
        'document',
      );
    if (rest.startsWith('spreadsheet'))
      return type(
        'application/vnd.oasis.opendocument.spreadsheet',
        'ods',
        'OpenDocument spreadsheet',
        'document',
      );
    if (rest.startsWith('presentation'))
      return type(
        'application/vnd.oasis.opendocument.presentation',
        'odp',
        'OpenDocument presentation',
        'document',
      );
  }
  if (findAscii(b, 'vbaProject.bin') >= 0) return refuse(MACROS);
  const office = 'application/vnd.openxmlformats-officedocument.';
  if (findAscii(b, 'word/document') >= 0)
    return type(`${office}wordprocessingml.document`, 'docx', 'Word document', 'document');
  if (findAscii(b, 'xl/workbook') >= 0)
    return type(`${office}spreadsheetml.sheet`, 'xlsx', 'Excel workbook', 'document');
  if (findAscii(b, 'ppt/presentation') >= 0)
    return type(
      `${office}presentationml.presentation`,
      'pptx',
      'PowerPoint presentation',
      'document',
    );
  return refuse("Zip files can't be uploaded. Upload the files inside it one at a time.");
}

function sniffOldOffice(b: Uint8Array): SniffResult {
  const has = (name: string) => findAscii(b, name, 0, b.length, true) >= 0;
  if (has('_VBA_PROJECT')) return refuse(MACROS);
  if (has('WordDocument')) return type('application/msword', 'doc', 'Word document', 'document');
  if (has('Workbook') || has('Book'))
    return type('application/vnd.ms-excel', 'xls', 'Excel workbook', 'document');
  if (has('PowerPoint Document'))
    return type('application/vnd.ms-powerpoint', 'ppt', 'PowerPoint presentation', 'document');
  return refuse(UNKNOWN);
}

/** True for control characters other than tab, line breaks and form feed (text files don't have them). */
function hasControlCharacters(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x7f || (code < 0x20 && (code < 0x09 || code > 0x0d))) return true;
  }
  return false;
}

function sniffText(b: Uint8Array, name: string): SniffResult {
  const text = decodeUtf8(b);
  if (text === null) {
    return refuse(
      b.subarray(0, 4096).includes(0)
        ? UNKNOWN
        : 'Text files need to be saved as UTF-8. Save it as UTF-8 and upload it again.',
    );
  }
  if (hasControlCharacters(text)) return refuse(UNKNOWN);
  const start = text.trimStart();
  if (/^WEBVTT([ \t\r\n]|$)/.test(text))
    return type('text/vtt', 'vtt', 'WebVTT captions file', 'captions');
  if (/^\d+\r?\n\d\d:\d\d:\d\d,\d{3} --> /.test(start)) {
    return refuse(
      'This is an SRT subtitle file. Captions need the WebVTT format: save it as .vtt and upload it again.',
    );
  }
  if (start.startsWith('<')) {
    return refuse(
      /<svg[\s>]/i.test(start)
        ? "SVG pictures can contain code, so they can't be uploaded. Save it as PNG and upload it again."
        : "Web pages and XML files can't be uploaded. Use an embed block or a link instead.",
    );
  }
  const extension = /\.(csv|md|markdown)$/i.exec(name)?.[1]?.toLowerCase();
  if (extension === 'csv') return type('text/csv', 'csv', 'CSV file', 'document');
  if (extension) return type('text/markdown', 'md', 'Markdown file', 'document');
  return type('text/plain', 'txt', 'text file', 'document');
}

/** Why an upload was refused. */
export type UploadProblem =
  | 'empty'
  | 'too_large'
  | 'unsupported'
  | 'wrong_kind'
  | 'damaged'
  | 'too_many_pixels'
  | 'bad_captions';

/** An accepted upload: what it is, how to serve it and, for pictures, its size. */
export type AcceptedUpload = {
  kind: MediaKind;
  mime: string;
  extension: string;
  label: string;
  name: string;
  bytes: number;
  width?: number;
  height?: number;
};

export type UploadCheck =
  ({ ok: true } & AcceptedUpload) | { ok: false; problem: UploadProblem; reason: string };

/**
 * Checks a file in the browser before it goes to the core files API (which checks the type again). `accept`
 * lists the kinds it may be (default: any); a file that could be several (an MP4 can be video or audio) takes
 * the first one that fits. Checks the content type, the size limit for its kind, picture dimensions and WebVTT
 * captions, and gives a clean name with the right extension. Pass the whole file or, for a big one, its first
 * `CHECK_HEAD_BYTES`, its last `CHECK_END_BYTES` as `end` and its full `size`.
 */
export function checkUpload(
  bytes: Uint8Array,
  options: { name?: string; accept?: readonly MediaKind[]; size?: number; end?: Uint8Array } = {},
): UploadCheck {
  const accept = options.accept && options.accept.length > 0 ? options.accept : MEDIA_KINDS;
  const size = options.size ?? bytes.length;
  const fail = (problem: UploadProblem, reason: string): UploadCheck => ({
    ok: false,
    problem,
    reason,
  });
  if (size === 0 || bytes.length === 0) return fail('empty', 'The file is empty.');
  const largest = sizeLimit(accept);
  if (size > largest)
    return fail(
      'too_large',
      `This file is ${formatBytes(size)}. Uploads here can be at most ${formatBytes(largest)}.`,
    );
  const sniffed = sniffFile(bytes, options.name, {
    partial: size > bytes.length,
    end: options.end,
  });
  if (!sniffed.ok) return fail('unsupported', sniffed.reason);
  const { type: found } = sniffed;
  const kind = found.kinds.find((possible) => accept.includes(possible));
  if (!kind) {
    const wanted = accept
      .map((k) => `${MEDIA_KIND_INFO[k].noun} (${MEDIA_KIND_INFO[k].formats})`)
      .join(' or ');
    return fail('wrong_kind', `This ${found.label} can't be used here. Choose ${wanted}.`);
  }
  const limit = MEDIA_SIZE_LIMITS[kind];
  if (size > limit) {
    const noun = MEDIA_KIND_INFO[kind].noun.replace(/^an? /, '');
    return fail(
      'too_large',
      `This ${noun} is ${formatBytes(size)}. ${capitalize(noun)}s can be at most ${formatBytes(limit)}.`,
    );
  }
  const accepted: AcceptedUpload = {
    kind,
    mime: kind === 'audio' ? found.mime.replace(/^video\//, 'audio/') : found.mime,
    extension: found.extension,
    label: found.label,
    name: safeFileName(options.name, found.extension),
    bytes: size,
  };
  if (found.kinds.includes('image')) {
    const pixels = readImageSize(bytes);
    if (!pixels)
      return fail('damaged', "This picture seems to be damaged: Care Hub can't read its size.");
    if (
      Math.max(pixels.width, pixels.height) > MAX_IMAGE_SIDE ||
      pixels.width * pixels.height > MAX_IMAGE_PIXELS
    ) {
      const n = (value: number) => value.toLocaleString('en-US');
      return fail(
        'too_many_pixels',
        `This picture is ${n(pixels.width)} × ${n(pixels.height)} pixels. Pictures can be at most ${n(MAX_IMAGE_SIDE)} pixels on a side and ${n(MAX_IMAGE_PIXELS / 1e6)} megapixels in total.`,
      );
    }
    accepted.width = pixels.width;
    accepted.height = pixels.height;
  }
  if (kind === 'captions') {
    const { problems } = parseWebVtt(decodeUtf8(bytes) ?? '');
    if (problems.length > 0) {
      const shown = problems
        .slice(0, 3)
        .map((p) => ` Line ${p.line}: ${p.message}`)
        .join('');
      const more = problems.length > 3 ? ` And ${problems.length - 3} more.` : '';
      return fail('bad_captions', `This captions file needs fixing.${shown}${more}`);
    }
  }
  return { ok: true, ...accepted };
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** A file size for people: "512 bytes", "2.4 MB", "50 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1023.5 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * A file name that is safe to store and to offer for download: no folders, control characters or characters
 * Windows refuses, at most 200 characters, ending in `extension` (the type found from the content).
 */
export function safeFileName(name: string | undefined, extension: string): string {
  let base = (name ?? '').split(/[\\/]/).pop() ?? '';
  base = Array.from(base.normalize('NFC'))
    .filter((char) => char >= ' ' && char !== '\x7f' && !'<>:"|?*'.includes(char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  base = base.replace(/\.[A-Za-z][A-Za-z0-9]{1,4}$/, '').replace(/^[\s.]+|[\s.]+$/g, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base = `_${base}`;
  const room = LIMITS.title - extension.length - 1;
  let short = '';
  for (const char of base || 'file') {
    if (short.length + char.length > room) break; // whole characters only, never half an emoji
    short += char;
  }
  return `${short.replace(/[\s.]+$/, '')}.${extension}`;
}
