import {
  CHECK_END_BYTES,
  CHECK_HEAD_BYTES,
  checkUpload,
  needsEnd,
  type MediaKind,
  type UploadCheck,
} from '@carehub/learning';

/** The bytes of a file or part of one (FileReader where `Blob.arrayBuffer` is missing). */
export function readBytes(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function')
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("The file couldn't be read."));
    reader.readAsArrayBuffer(blob);
  });
}

/**
 * Checks a chosen file before it is uploaded (the server checks it again): reads its first megabyte and, for
 * zip-based and old Office files, its end, then runs `checkUpload` with its full size.
 */
export async function checkFile(file: File, accept: readonly MediaKind[]): Promise<UploadCheck> {
  const head = await readBytes(file.slice(0, CHECK_HEAD_BYTES));
  const end =
    file.size > CHECK_HEAD_BYTES && needsEnd(head)
      ? await readBytes(file.slice(Math.max(CHECK_HEAD_BYTES, file.size - CHECK_END_BYTES)))
      : undefined;
  return checkUpload(head, { name: file.name, accept, size: file.size, end });
}
