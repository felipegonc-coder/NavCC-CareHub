import { inflateRawSync } from 'node:zlib';
import { decodeCsvBytes } from '@carehub/databases/csv';
import { readZip, readZipEntry, type ZipEntry, type ZipProblem } from '@carehub/databases/xlsx';
import { SERVER_IMPORTERS } from '@carehub/extras/import-export/import/importers';
import {
  ImportFileError,
  checkPlan,
  planUploadSchema,
  type ImportPlan,
  type ImportOptions,
  type ImportProblem,
  type ImportSourceId,
  type ImportZip,
} from '@carehub/extras/import-export/import/index';

// Reading an upload into a plan, with #109's zip reader and its limits (docs/extras/import-export.md
// #safety). It runs in the import worker thread (worker.ts); isolate.ts starts it.

/** What the person picked: the upload and how to read it. */
export interface ReadRequest {
  source: ImportSourceId;
  fileName: string;
  bytes: Uint8Array;
  /** The Import screen read the file itself: the upload is a zip of plan.json and the files. */
  planned: boolean;
  /** The source's options that the person ticked, kept with the import. */
  options?: ImportOptions;
}

/** The plan, with each file's bytes in the order of `plan.files`. */
export interface ReadResult {
  plan: ImportPlan;
  files: Uint8Array[];
}

const ZIP_REASONS: Record<ZipProblem, string> = {
  not_zip: "the file isn't a zip",
  damaged: 'the zip is damaged',
  unsupported: "the zip is packed in a way Care Hub can't open",
  encrypted: 'the zip has a password',
  too_many_entries: 'zips can have up to 1,000 files',
  entry_too_big: 'a file inside is over 50 MB',
  too_big: 'the zip unpacks to more than 100 MB',
};

/** Entries over 1 MB may unpack to at most 200 times their packed size (zip bomb safety). */
const RATIO = { from: 1024 * 1024, max: 200 };

const inflate = (bytes: Uint8Array, max: number) => inflateRawSync(bytes, { maxOutputLength: max });

/** zlib and the zip reader hand back Buffers: importers and the job get plain Uint8Arrays. */
const plain = (bytes: Uint8Array): Uint8Array =>
  bytes.constructor === Uint8Array
    ? bytes
    : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** A zip as importers read it. Names are only compared, never used as paths. */
export function openZip(bytes: Uint8Array): ImportZip {
  const read = readZip(bytes);
  if (!read.ok) throw new ImportFileError(ZIP_REASONS[read.problem]);
  const entries = new Map<string, ZipEntry>();
  for (const entry of read.zip.entries) {
    if (entry.size > RATIO.from && entry.size > entry.compressedSize * RATIO.max) {
      throw new ImportFileError('the zip is packed too tightly to open safely');
    }
    if (!entry.name.endsWith('/') && !entries.has(entry.name)) entries.set(entry.name, entry);
  }
  const bytesOf = (name: string): Uint8Array => {
    const entry = entries.get(name);
    if (!entry) throw new ImportFileError('the zip is damaged');
    const result = readZipEntry(read.zip, entry, inflate);
    if (!result.ok) throw new ImportFileError(ZIP_REASONS[result.problem]);
    return plain(result.bytes);
  };
  return {
    names: [...entries.keys()],
    read: async (name) => bytesOf(name),
    text: async (name) => decodeCsvBytes(bytesOf(name)),
  };
}

const isZipName = (fileName: string) => /\.zip$/i.test(fileName);

/** Mac programs (Mach-O, 32 and 64 bit, either byte order) and universal binaries. */
const MACH_O = new Set([0xcffaedfe, 0xcefaedfe, 0xfeedface, 0xfeedfacf, 0xcafebabe]);

/** Windows, Linux and Mac programs and scripts, by their first bytes, whatever their name says. */
function isProgram(bytes: Uint8Array): boolean {
  const [a, b, c, d] = bytes;
  const first4 = bytes.length >= 4 ? new DataView(bytes.buffer, bytes.byteOffset, 4) : null;
  if (first4 && MACH_O.has(first4.getUint32(0))) return true;
  return (
    (a === 0x4d && b === 0x5a) ||
    (a === 0x7f && b === 0x45 && c === 0x4c && d === 0x46) ||
    (a === 0x23 && b === 0x21)
  );
}

async function planOf(request: ReadRequest, zip: ImportZip | null): Promise<ImportPlan> {
  if (request.planned) {
    if (!zip?.names.includes('plan.json')) throw new ImportFileError('the import is damaged');
    let json: unknown;
    try {
      json = JSON.parse(await zip.text('plan.json'));
    } catch {
      throw new ImportFileError('the import is damaged');
    }
    const parsed = planUploadSchema.safeParse(json);
    if (!parsed.success) throw new ImportFileError('the import is damaged');
    return parsed.data as ImportPlan;
  }
  const importer = SERVER_IMPORTERS[request.source];
  if (!importer) throw new ImportFileError("this kind of file can't be imported yet");
  const { fileName, bytes, options = {} } = request;
  const text = async () => decodeCsvBytes(bytes);
  return importer.plan({ fileName, bytes, text, zip, options });
}

/**
 * Reads the upload into a plan and checks it against the limits. Files the plan names but the zip
 * doesn't have, and programs, are left out and listed.
 */
export async function readUpload(request: ReadRequest): Promise<ReadResult> {
  const zip = request.planned || isZipName(request.fileName) ? openZip(request.bytes) : null;
  const plan = await planOf(request, zip);
  checkPlan(plan);
  const problems: ImportProblem[] = [...plan.problems];
  const kept: ImportPlan['files'] = [];
  const files: Uint8Array[] = [];
  for (const file of plan.files) {
    const bytes =
      file.bytes ??
      (file.entry && zip?.names.includes(file.entry) ? await zip.read(file.entry) : null);
    if (bytes === null) {
      problems.push({ file: file.name, what: 'Skipped', why: "It isn't in the zip." });
    } else if (isProgram(bytes)) {
      problems.push({ file: file.name, what: 'Refused', why: "Programs can't be imported." });
    } else {
      kept.push({ key: file.key, name: file.name });
      files.push(plain(bytes));
    }
  }
  return { plan: { ...plan, files: kept, problems }, files };
}
