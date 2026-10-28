import { z } from 'zod';
import { TEMPLATE_LIMITS, type TemplateCard, type TemplatePreviewPage } from './gallery';

// Request bodies and answers of /api/templates (docs/extras/testing.md, "Templates and buttons").

const text = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, { error: `${what} can be up to ${max} characters.` });

const name = text(TEMPLATE_LIMITS.name, 'A name').min(1, { error: 'Give the template a name.' });
const category = text(TEMPLATE_LIMITS.category, 'A category').min(1, {
  error: 'Pick or type a category.',
});
const description = text(TEMPLATE_LIMITS.description, 'A description');

/** A workspace template's UUID, or a starter's key such as `meeting-notes`. */
export const templateIdSchema = z
  .string()
  .regex(
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9]+(?:-[a-z0-9]+)*)$/i,
    {
      error: "That template ID isn't right.",
    },
  )
  .max(60);

export const templateAudienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('everyone') }),
  z.object({ type: z.literal('space'), spaceId: z.uuid({ error: "That space ID isn't right." }) }),
  z.object({ type: z.literal('me') }),
]);

/** POST /api/templates: Save as template, from the page menu. */
export const saveTemplateSchema = z.object({
  pageId: z.uuid({ error: "That page ID isn't right." }),
  name,
  description: description.default(''),
  category,
  audience: templateAudienceSchema,
  includeSubpages: z.boolean().default(true),
});
export type SaveTemplateInput = z.infer<typeof saveTemplateSchema>;

/** PATCH /api/templates/:id: Rename, Change category, Who can use it. */
export const updateTemplateSchema = z
  .object({ name, description, category, audience: templateAudienceSchema })
  .partial()
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    error: 'Nothing to change.',
  });
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

/** Where Use template puts the copy ("Add to:"). */
export const useTargetSchema = z.discriminatedUnion('type', [
  /** The person's Private section. */
  z.object({ type: z.literal('private') }),
  /** A new sub-page of this page. */
  z.object({ type: z.literal('page'), pageId: z.uuid({ error: "That page ID isn't right." }) }),
  /** This (empty) page itself: its content, then the template's sub-pages under it. */
  z.object({ type: z.literal('apply'), pageId: z.uuid({ error: "That page ID isn't right." }) }),
]);
export type UseTarget = z.infer<typeof useTargetSchema>;

/** POST /api/templates/:id/use */
export const useTemplateSchema = z.object({
  target: useTargetSchema,
  includeSampleRows: z.boolean().default(true),
});
export type UseTemplateInput = z.infer<typeof useTemplateSchema>;

/** A team space whose members a template can be for ("Members of a space"). */
export interface TemplateSpace {
  id: string;
  name: string;
}

/** GET /api/templates */
export interface GalleryResponse {
  templates: TemplateCard[];
  categories: string[];
  /** May save pages as workspace templates (the Templates permission). */
  canSave: boolean;
  /** The team spaces the person is in, for "Who can use it"; none are offered without it. */
  spaces?: TemplateSpace[];
}

/** GET /api/templates/:id: the read-only preview. */
export interface TemplatePreviewResponse {
  template: TemplateCard;
  pages: TemplatePreviewPage[];
  /** The top page's content as Markdown, variables still as chips. */
  markdown: string;
}

/** POST /api/templates/:id/use */
export interface UseTemplateResponse {
  /** The new top page (or the page the template was applied to). */
  pageId: string;
  /** Titles of databases that couldn't be copied yet. */
  notCopied: string[];
}
