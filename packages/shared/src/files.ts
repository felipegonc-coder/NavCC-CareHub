import { z } from 'zod';

// Files (decision 0007, section 4.3): uploads, and the addresses that show or download them.

/**
 * Where an upload belongs: `<feature>:<id>`, for example `pages:<page id>`. The feature decides who may
 * add and open its files (`registerFileScope` on the server).
 */
export const fileScopeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,39}:[\w.:-]{1,200}$/, 'Choose where the file goes.');

/** The query of POST /api/files (the file itself is the multipart field `file`). */
export const fileUploadQuerySchema = z.object({ scope: fileScopeSchema });

/** The body of POST /api/files/from-url: a picture on another website, and where its copy goes. */
export const fileFromUrlBodySchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Paste the address of a picture.')
    .max(2048, 'That address is too long.'),
  scope: fileScopeSchema,
});

/** The params of GET and DELETE /api/files/:id. */
export const fileParamsSchema = z.object({ id: z.uuid() });

/** The query of GET /api/files/:id. `download=1` saves the file instead of showing it. */
export const fileReadQuerySchema = z.object({ download: z.enum(['0', '1']).optional() });

/** What POST /api/files and POST /api/files/from-url answer. */
export const uploadedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** In bytes. */
  size: z.number().int().min(0),
  /** Found from the file's contents, not from its name. */
  mimeType: z.string(),
  /** Shows the file (pictures, video, audio and PDFs) or downloads it (everything else). */
  url: z.string(),
  /** Pictures only: pixels as shown. */
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type UploadedFile = z.infer<typeof uploadedFileSchema>;

/** The address of a stored file; `download` saves it instead of showing it. */
export function fileUrl(id: string, options: { download?: boolean } = {}): string {
  return `/api/files/${encodeURIComponent(id)}${options.download ? '?download=1' : ''}`;
}
