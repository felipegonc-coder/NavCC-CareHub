// The real type of a file, found from its bytes (Data settings 3.3): what the browser says and the
// name's ending are never trusted for that. The ending only tells apart formats that share a
// container, such as Word and Excel files, and refuses program endings on its own.

export type FileKind = 'picture' | 'video' | 'audio' | 'pdf' | 'document' | 'text' | 'other';

export interface FileType {
  mimeType: string;
  kind: FileKind;
}

/** Reads up to `length` bytes at `offset` (fewer near the end of the file). */
export type ReadAt = (offset: number, length: number) => Promise<Buffer>;

/** How many bytes from the start of a file `detectFileType` looks at. */
export const HEAD_BYTES = 4096;

/** Endings that are always refused (Data settings 3.3). Admins can add more, never remove these. */
export const BUILT_IN_BLOCKED_ENDINGS: readonly string[] = [
  ...['exe', 'msi', 'msp', 'msix', 'msixbundle', 'appx', 'appxbundle', 'bat', 'cmd', 'com', 'scr'],
  ...['pif', 'cpl', 'msc', 'hta', 'reg', 'lnk', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf'],
  ...['wsh', 'jar', 'app', 'dmg', 'pkg', 'mpkg', 'command', 'sh', 'bash', 'zsh', 'csh', 'ksh'],
  ...['run', 'appimage', 'deb', 'rpm', 'apk', 'aab', 'xapk', 'ipa'],
];

/** Types that open in the browser; everything else is always sent as a download. */
const SHOWN_IN_BROWSER: Readonly<Record<string, FileKind>> = {
  'image/png': 'picture',
  'image/jpeg': 'picture',
  'image/gif': 'picture',
  'image/webp': 'picture',
  'image/avif': 'picture',
  'image/heic': 'picture',
  'image/heif': 'picture',
  'image/svg+xml': 'picture',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/wav': 'audio',
  'audio/ogg': 'audio',
  'audio/flac': 'audio',
  'audio/aac': 'audio',
  'application/pdf': 'pdf',
};

/** Whether a stored type is shown in the browser (pictures, video, audio and PDFs). */
export function showsInBrowser(mimeType: string): boolean {
  return mimeType in SHOWN_IN_BROWSER;
}

/** The lower-case ending of a name, ignoring trailing dots and spaces (which Windows drops). */
export function fileEnding(name: string): string {
  const trimmed = name.replace(/[\s.]+$/u, '').toLowerCase();
  const dot = trimmed.lastIndexOf('.');
  return dot === -1 ? '' : trimmed.slice(dot + 1);
}

/** Whether a name ends like a program: the built-in endings plus any the workspace added. */
export function hasBlockedEnding(name: string, extra: readonly string[] = []): boolean {
  const ending = fileEnding(name);
  if (!ending) return false;
  return (
    BUILT_IN_BLOCKED_ENDINGS.includes(ending) ||
    extra.some((item) => item.trim().replace(/^\./, '').toLowerCase() === ending)
  );
}

const typed = (mimeType: string, kind: FileKind): FileType => ({ mimeType, kind });
const known = (mimeType: string): FileType =>
  typed(mimeType, SHOWN_IN_BROWSER[mimeType] ?? 'other');
const latin1 = (buffer: Buffer, start: number, end: number) =>
  buffer.toString('latin1', start, Math.min(end, buffer.length));
const u32 = (buffer: Buffer, offset: number) =>
  buffer.length >= offset + 4 ? buffer.readUInt32BE(offset) : -1;

const PROGRAM_MAGIC = new Set([
  0x7f454c46, // Linux programs (ELF)
  0xfeedface, // Mac programs (Mach-O), both byte orders and 32 or 64 bits
  0xfeedfacf,
  0xcefaedfe,
  0xcffaedfe,
  0xcafebabe, // Mac universal programs, and Java classes
  0xcafebabf,
  0xbebafeca,
  0xedabeedb, // RPM packages
]);

/** Programs recognisable from their first bytes. */
function startsLikeProgram(head: Buffer): boolean {
  const two = latin1(head, 0, 2);
  return (
    two === 'MZ' || // Windows and DOS programs
    (two === '#!' && latin1(head, 0, 5) !== '#!AMR') || // scripts (AMR voice notes also start with #!)
    PROGRAM_MAGIC.has(u32(head, 0)) ||
    latin1(head, 0, 4) === 'xar!' || // Mac installer packages
    latin1(head, 0, 8) === '!<arch>\n' || // Debian packages
    (u32(head, 0) === 0x4c000000 && u32(head, 4) === 0x01140200) // Windows shortcuts
  );
}

const OFFICE_BY_ENDING: Readonly<Record<string, string>> = {
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  msg: 'application/vnd.ms-outlook',
};

const OOXML = 'application/vnd.openxmlformats-officedocument.';

const TEXT_BY_ENDING: Readonly<Record<string, string>> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  ics: 'text/calendar',
  vtt: 'text/vtt',
};

/**
 * The real type of a file, or `'program'` for programs and installers (refused on upload).
 * `head` is the first `HEAD_BYTES` (or the whole file if shorter); `read` reaches the rest.
 */
export async function detectFileType(file: {
  head: Buffer;
  size: number;
  name: string;
  read: ReadAt;
}): Promise<FileType | 'program'> {
  const { head, size, name, read } = file;
  if (startsLikeProgram(head)) return 'program';
  // Mac disk images keep their signature in the last 512 bytes.
  if (size >= 512 && latin1(await read(size - 512, 4), 0, 4) === 'koly') return 'program';
  const four = latin1(head, 0, 4);
  if (four === 'PK\x03\x04' || four === 'PK\x05\x06') return zipType(head, size, read);
  if (u32(head, 0) === 0xd0cf11e0 && u32(head, 4) === 0xa1b11ae1) {
    if (await isWindowsInstaller(head, read)) return 'program';
    return typed(OFFICE_BY_ENDING[fileEnding(name)] ?? 'application/x-ole-storage', 'document');
  }
  return (
    binaryType(head) ??
    textType(head, name, size > head.length) ??
    known('application/octet-stream')
  );
}

function binaryType(head: Buffer): FileType | null {
  const at = (start: number, end: number) => latin1(head, start, end);
  if (u32(head, 0) === 0x89504e47 && u32(head, 4) === 0x0d0a1a0a) return known('image/png');
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return known('image/jpeg');
  if (at(0, 6) === 'GIF87a' || at(0, 6) === 'GIF89a') return known('image/gif');
  if (at(0, 4) === 'RIFF') {
    const form = at(8, 12);
    if (form === 'WEBP') return known('image/webp');
    if (form === 'WAVE') return known('audio/wav');
    return known(form === 'AVI ' ? 'video/x-msvideo' : 'application/octet-stream');
  }
  if (at(4, 8) === 'ftyp') return isoMediaType(head);
  if (['moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(at(4, 8))) {
    return known('video/quicktime'); // older QuickTime files have no ftyp box
  }
  if (u32(head, 0) === 0x1a45dfa3) {
    return known(at(0, 64).includes('webm') ? 'video/webm' : 'video/x-matroska');
  }
  if (at(0, 3) === 'ID3') return known('audio/mpeg');
  if (at(0, 4) === 'OggS') return known('audio/ogg');
  if (at(0, 4) === 'fLaC') return known('audio/flac');
  if (at(0, 5) === '#!AMR') return known('audio/amr');
  const second = head[1] ?? 0;
  if (head[0] === 0xff && (second & 0xe0) === 0xe0) {
    if ((second & 0xf6) === 0xf0) return known('audio/aac'); // ADTS
    if ((second & 0x06) !== 0) return known('audio/mpeg'); // MPEG audio frame (layer bits set)
  }
  if (at(0, 1024).includes('%PDF-')) return known('application/pdf');
  if (at(0, 5) === '{\\rtf') return typed('application/rtf', 'document');
  return null;
}

/** MP4, QuickTime, M4A, AVIF and HEIC share the ISO media format; the ftyp brands tell them apart. */
function isoMediaType(head: Buffer): FileType {
  const boxEnd = Math.min(u32(head, 0), head.length);
  const major = latin1(head, 8, 12);
  const brands = new Set([major]);
  for (let offset = 16; offset + 4 <= boxEnd; offset += 4)
    brands.add(latin1(head, offset, offset + 4));
  const has = (...names: string[]) => names.some((brand) => brands.has(brand));
  if (has('avif', 'avis')) return known('image/avif');
  if (has('heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs'))
    return known('image/heic');
  if (has('mif1', 'msf1')) return known('image/heif');
  if (['M4A ', 'M4B ', 'M4P '].includes(major)) return known('audio/mp4');
  if (major === 'qt  ') return known('video/quicktime');
  if (major.startsWith('3g')) return known('video/3gpp');
  return known('video/mp4');
}

/** Windows Installer files (.msi, .msp, .mst) by the class ID of their root storage. */
async function isWindowsInstaller(head: Buffer, read: ReadAt): Promise<boolean> {
  if (head.length < 52) return false;
  const sectorSize = 2 ** head.readUInt16LE(30);
  if (sectorSize !== 512 && sectorSize !== 4096) return false;
  const root = await read((head.readUInt32LE(48) + 1) * sectorSize, 96);
  if (root.length < 96) return false;
  return /^8[246]100c0000000000c000000000000046$/.test(root.subarray(80, 96).toString('hex'));
}

const PROGRAM_ENTRY =
  /^(?:META-INF\/MANIFEST\.MF|AndroidManifest\.xml|classes\.dex|AppxManifest\.xml|AppxMetadata\/AppxBundleManifest\.xml|Payload\/[^/]+\.app\/.*)$/;

/** Office and OpenDocument files, Java and phone programs, and plain archives all are ZIP files. */
async function zipType(head: Buffer, size: number, read: ReadAt): Promise<FileType | 'program'> {
  const names = await zipEntryNames(size, read);
  if (head.length >= 30) names.push(latin1(head, 30, 30 + head.readUInt16LE(26)));
  if (names.some((entry) => PROGRAM_ENTRY.test(entry))) return 'program';
  if (names[names.length - 1] === 'mimetype' && head.length >= 30) {
    // OpenDocument and EPUB files start with an uncompressed "mimetype" entry.
    const start = 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const declared = /^application\/[a-z0-9.+-]+/.exec(latin1(head, start, start + 100))?.[0];
    if (declared?.startsWith('application/vnd.oasis.opendocument.'))
      return typed(declared, 'document');
    if (declared === 'application/epub+zip') return typed(declared, 'document');
  }
  if (names.includes('[Content_Types].xml')) {
    const under = (folder: string) => names.some((entry) => entry.startsWith(folder));
    if (under('word/')) return typed(`${OOXML}wordprocessingml.document`, 'document');
    if (under('xl/')) return typed(`${OOXML}spreadsheetml.sheet`, 'document');
    if (under('ppt/')) return typed(`${OOXML}presentationml.presentation`, 'document');
  }
  return known('application/zip');
}

/** Entry names from a ZIP file's central directory (empty if it can't be read, e.g. ZIP64). */
export async function zipEntryNames(size: number, read: ReadAt): Promise<string[]> {
  const tailStart = Math.max(0, size - 65_557);
  const tail = await read(tailStart, size - tailStart);
  const end = tail.lastIndexOf('PK\x05\x06', undefined, 'latin1');
  if (end === -1 || end + 22 > tail.length) return [];
  const count = tail.readUInt16LE(end + 10);
  const length = tail.readUInt32LE(end + 12);
  const offset = tail.readUInt32LE(end + 16);
  if (offset + length > size) return [];
  const directory = await read(offset, Math.min(length, 8 * 1024 * 1024));
  const names: string[] = [];
  let at = 0;
  while (
    names.length < count &&
    at + 46 <= directory.length &&
    directory.readUInt32LE(at) === 0x02014b50
  ) {
    const nameLength = directory.readUInt16LE(at + 28);
    names.push(directory.toString('utf8', at + 46, at + 46 + nameLength));
    at += 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
  }
  return names;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Valid UTF-8 without NUL bytes; a character cut off at the end of the sample is fine. */
function isUtf8Text(head: Buffer, cut: boolean): boolean {
  if (head.length === 0 || head.includes(0)) return false;
  for (let drop = 0; drop <= (cut ? 3 : 0); drop += 1) {
    try {
      utf8.decode(head.subarray(0, head.length - drop));
      return true;
    } catch {
      // Try again without the last bytes, which may be part of a character cut off by the sample.
    }
  }
  return false;
}

const XML_PROLOG =
  /^(?:\s+|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>)*/i;

function textType(head: Buffer, name: string, cut: boolean): FileType | null {
  const utf16 = (head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff);
  if (!utf16 && !isUtf8Text(head, cut)) return null;
  if (!utf16) {
    const text = head.toString('utf8').replace(/^\uFEFF/, '');
    if (/^<(?:svg:)?svg[\s>/]/.test(text.replace(XML_PROLOG, ''))) return known('image/svg+xml');
  }
  return typed(TEXT_BY_ENDING[fileEnding(name)] ?? 'text/plain', 'text');
}
