// What may be uploaded in scopes registered with `allowAnonymous` (forms anyone can fill in, decisions
// 0010 and 0200), whoever uploads: pictures (redrawn), PDFs, Word, Excel and PowerPoint files without
// macros, and plain text, each named with the ending its contents have.
import { fileEnding, zipEntryNames, type FileType, type ReadAt } from './detect';

const OOXML = 'application/vnd.openxmlformats-officedocument.';

/** The types taken, with the endings each may have. */
const TAKEN: Readonly<Record<string, readonly string[]>> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'application/pdf': ['pdf'],
  [`${OOXML}wordprocessingml.document`]: ['docx'],
  [`${OOXML}spreadsheetml.sheet`]: ['xlsx'],
  [`${OOXML}presentationml.presentation`]: ['pptx'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
};

/** Parts of Office files that hold macros, ActiveX controls, or embedded objects that can run. */
const ACTIVE_PART =
  /(?:^|\/)vba(?:Project\.bin|Data\.xml)$|^xl\/macrosheets\/|(?:^|\/)activeX\/|(?:^|\/)embeddings\/[^/]*\.(?:bin|docm|xlsm|xlsb|pptm)$/i;

const NOT_TAKEN =
  'Only JPEG and PNG pictures, PDFs, Word, Excel and PowerPoint files (.docx, .xlsx and .pptx) and ' +
  'text files (.txt and .csv) can be added here.';
const ACTIVE =
  "Files with macros or ActiveX controls can't be added here. Save a copy without them and try again.";
const UNREADABLE = "This file seems to be damaged, so it wasn't uploaded.";

/**
 * Why a file can't be added to an anonymous scope, or null when it can. Pictures get their ending added
 * instead (withPictureEnding), as they're drawn again anyway.
 */
export async function anonymousRefusal(file: {
  type: FileType;
  name: string;
  size: number;
  read: ReadAt;
}): Promise<string | null> {
  const endings = TAKEN[file.type.mimeType];
  if (!endings) return NOT_TAKEN;
  if (file.type.mimeType.startsWith(OOXML)) {
    const parts = await zipEntryNames(file.size, file.read);
    if (parts.length === 0) return UNREADABLE;
    if (parts.some((part) => ACTIVE_PART.test(part))) return ACTIVE;
  }
  if (file.type.kind === 'picture' || endings.includes(fileEnding(file.name))) return null;
  return `This file's name doesn't match what's in it. Rename it to end in .${endings[0]} and try again.`;
}
