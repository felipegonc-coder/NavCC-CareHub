import { z } from 'zod';
import { text } from './zod-helpers';

/** Format constants. Bump `COURSE_FORMAT_VERSION` only together with a migration in `migrations.ts`. */
export const COURSE_FILE_FORMAT = 'carehub.learning.course';
export const COURSE_FORMAT_VERSION = 1;
export const LEARNING_PATH_FORMAT_VERSION = 1;

/** Every size limit the schema enforces, for editors (character counters, disabled "Add" buttons) and tests. */
export const LIMITS = {
  externalId: 200, // fileId, pageId
  url: 2_000,
  richText: 20_000, // characters across all runs
  paragraphs: 2_000,
  runsPerParagraph: 1_000,
  title: 200, // titles, names, headings and other one-line text
  label: 40, // button labels
  buttonLabel: 100,
  shortText: 500, // summaries, captions, alt text, option and item text, descriptions
  longText: 2_000, // quotes, scene text, flashcard backs, fill-in-the-blank text
  statement: 300,
  code: 20_000,
  topics: 10,
  topic: 40,
  estimatedMinutes: 600,
  minimumCourseSeconds: 36_000,
  minimumLessonSeconds: 3_600,
  lessons: 100,
  blocks: 300,
  questions: 200,
  maxAttempts: 20,
  listItems: 100,
  quotes: 10,
  tableRows: 50,
  tableColumns: 10,
  tableCell: 1_000,
  galleryImages: 20,
  markers: 20,
  captions: 10,
  embedHeight: { min: 100, max: 1_200 },
  accordionItems: 20,
  tabs: 10,
  timelineItems: 30,
  processSteps: 20,
  flashcards: 30,
  sortingCategories: 4,
  sortingItems: 20,
  scenarioCharacters: 10,
  scenarioScenes: 100,
  sceneText: 2_000,
  scenarioChoices: 6,
  choicePoints: 10, // -10..10
  scenarioPassScore: 1_000, // -1000..1000
  questionPoints: 100,
  options: 6,
  pairs: 8,
  fillParts: 50,
  blankAnswers: 10,
  blankAnswer: 200,
  blankResponse: 500,
  orderingItems: 10,
  hotspotSpots: 10,
  bankDraws: 10,
  bankDrawCount: 50,
  bankSnapshotQuestions: 500,
  reviewEveryMonths: 36,
  pathCourses: 30,
  pathDescription: 1_000,
  certificateMonths: 120,
} as const;

/** Lesson, block, question and nested ids. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const EXTERNAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

/** Names that exist on every JavaScript object. Ids become object keys, so these are not allowed as ids. */
export const RESERVED_IDS = [
  '__proto__',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
  'constructor',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
  'toString',
  'valueOf',
] as const;

/** True for ids that would clash with built-in object properties, such as "constructor". */
export function isReservedId(id: string): boolean {
  return (RESERVED_IDS as readonly string[]).includes(id) || id in Object.prototype;
}

export const IdSchema = z
  .string()
  .regex(ID_PATTERN, { error: 'Use 1 to 64 letters, digits, "_" or "-".' })
  .refine((id) => !isReservedId(id), { error: 'This id is reserved; choose another.' })
  .meta({ not: { enum: [...RESERVED_IDS] } });

/** Ids from other Care Hub services (file storage, pages). */
export const ExternalIdSchema = z.string().regex(EXTERNAL_ID_PATTERN, {
  error: 'Use up to 200 letters, digits, ".", "_", ":" or "-", starting with a letter or digit.',
});

/** ISO 8601 date and time with a time zone, e.g. "2026-10-27T15:00:00.000Z". */
export const IsoDateTimeSchema = z.iso.datetime({
  offset: true,
  error: 'Use an ISO 8601 date and time, e.g. 2026-10-27T15:00:00.000Z.',
});

/** A calendar day, "YYYY-MM-DD". */
export const IsoDateSchema = z.iso.date({
  error: 'Use a calendar day written as YYYY-MM-DD, e.g. 2026-10-27.',
});

// The WHATWG URL parser exists in browsers and Node; typed locally so this package needs no DOM or Node types.
type ParsedUrl = {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  pathname: string;
};
const UrlParser = (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL;

function parseUrl(value: string, scheme: RegExp): ParsedUrl | null {
  if (!scheme.test(value) || /\s/.test(value)) return null;
  try {
    return new UrlParser(value);
  } catch {
    return null;
  }
}

/** True for a full https:// address with no spaces and no user name or password. */
export function isHttpsUrl(value: string): boolean {
  const url = parseUrl(value, /^https:\/\/[^/\\]/i);
  return (
    url !== null &&
    url.protocol === 'https:' &&
    url.hostname !== '' &&
    url.username === '' &&
    url.password === ''
  );
}

function isMailtoUrl(value: string): boolean {
  const url = parseUrl(value, /^mailto:/i);
  return url !== null && url.protocol === 'mailto:' && url.pathname !== '';
}

export const HttpsUrlSchema = z
  .string()
  .max(LIMITS.url)
  .refine(isHttpsUrl, { error: 'Use a full https:// address (no user name or password).' })
  .meta({ format: 'uri', pattern: '^[Hh][Tt][Tt][Pp][Ss]://[^/\\\\\\s]\\S*$' });

export const LinkUrlSchema = z
  .string()
  .max(LIMITS.url)
  .refine((value) => isHttpsUrl(value) || isMailtoUrl(value), {
    error: 'Use a full https:// or mailto: address.',
  })
  .meta({
    format: 'uri',
    pattern: '^([Hh][Tt][Tt][Pp][Ss]://[^/\\\\\\s]|[Mm][Aa][Ii][Ll][Tt][Oo]:\\S)\\S*$',
  });

// ---------- Rich text ----------

export const MarkSchema = z.enum(['bold', 'italic', 'underline', 'strike', 'code']);

export const LinkSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('url'), url: LinkUrlSchema }),
  z.strictObject({ kind: z.literal('page'), pageId: ExternalIdSchema }),
  z.strictObject({ kind: z.literal('lesson'), lessonId: IdSchema, blockId: IdSchema.optional() }),
]);

export const TextRunSchema = z.strictObject({
  text: text(LIMITS.richText),
  marks: z.array(MarkSchema).max(5).optional(),
  link: LinkSchema.optional(),
});

export const ParagraphSchema = z.strictObject({
  runs: z.array(TextRunSchema).max(LIMITS.runsPerParagraph),
});

/** Number of characters in rich text, counted across all runs. */
export function richTextLength(
  paragraphs: readonly { runs: readonly { text: string }[] }[],
): number {
  let total = 0;
  for (const paragraph of paragraphs) for (const run of paragraph.runs) total += run.text.length;
  return total;
}

export const RichTextSchema = z
  .array(ParagraphSchema)
  .max(LIMITS.paragraphs)
  .superRefine((paragraphs, ctx) => {
    const length = richTextLength(paragraphs);
    if (length > LIMITS.richText) {
      ctx.addIssue({
        code: 'custom',
        message: `Text can be at most ${LIMITS.richText.toLocaleString('en-US')} characters (this has ${length.toLocaleString('en-US')}).`,
      });
    }
  })
  .meta({
    description: `Paragraphs of text runs; "\\n" inside a run is a line break. At most ${LIMITS.richText} characters in total.`,
  });

// ---------- Media ----------

export const MediaRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('file'), fileId: ExternalIdSchema }),
  z.strictObject({ kind: z.literal('url'), url: HttpsUrlSchema }),
]);

export const ImageSchema = z.strictObject({
  media: MediaRefSchema,
  alt: text(LIMITS.shortText),
  caption: text(LIMITS.shortText).optional(),
  decorative: z.boolean().optional(),
});

export type Id = z.infer<typeof IdSchema>;
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;
export type IsoDate = z.infer<typeof IsoDateSchema>;
export type Mark = z.infer<typeof MarkSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type TextRun = z.infer<typeof TextRunSchema>;
export type Paragraph = z.infer<typeof ParagraphSchema>;
export type RichText = z.infer<typeof RichTextSchema>;
export type MediaRef = z.infer<typeof MediaRefSchema>;
export type Image = z.infer<typeof ImageSchema>;
