import { z } from 'zod';
import { BlockSchema } from './blocks';
import { CourseFileSchema, CourseSchema, LessonSchema } from './course';
import {
  COURSE_FORMAT_VERSION,
  ExternalIdSchema,
  IdSchema,
  ImageSchema,
  IsoDateTimeSchema,
  MediaRefSchema,
  RichTextSchema,
} from './primitives';
import { QuestionSchema } from './questions';

// Shared shapes get a name in `$defs`, so the file stays readable and importers can refer to them.
const NAMED: readonly (readonly [z.core.$ZodType, string])[] = [
  [IdSchema, 'Id'],
  [ExternalIdSchema, 'ExternalId'],
  [RichTextSchema, 'RichText'],
  [MediaRefSchema, 'MediaRef'],
  [ImageSchema, 'Image'],
  [QuestionSchema, 'Question'],
  [BlockSchema, 'Block'],
  [LessonSchema, 'Lesson'],
  [CourseSchema, 'Course'],
];

// zod's own date-time regex changes between zod versions, so the file states the documented shape itself:
// a date, hours and minutes, optional seconds and fraction, then `Z` or `+hh:mm`. The parser still checks
// that the day exists.
const DATE_TIME_PATTERN =
  '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])T([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d(\\.\\d+)?)?(Z|[+-]([01]\\d|2[0-3]):[0-5]\\d)$';

const isSchema = (value: unknown): value is z.core.$ZodType =>
  typeof value === 'object' && value !== null && '_zod' in value;

function children(schema: z.core.$ZodType): z.core.$ZodType[] {
  const def = schema._zod.def as unknown as Record<string, unknown>;
  const found: unknown[] = [
    'element',
    'innerType',
    'keyType',
    'valueType',
    'in',
    'out',
    'left',
    'right',
    'rest',
  ].map((key) => def[key]);
  for (const key of ['options', 'items']) {
    const list = def[key];
    if (Array.isArray(list)) found.push(...list);
  }
  if (typeof def.shape === 'object' && def.shape !== null) found.push(...Object.values(def.shape));
  return found.filter(isSchema);
}

// Copies the descriptions, patterns and other `.meta()` notes from the global registry, so naming shapes
// here never changes global state.
function copyMetadata(
  schema: z.core.$ZodType,
  into: z.core.$ZodRegistry<z.core.GlobalMeta>,
  seen: Set<z.core.$ZodType>,
) {
  if (seen.has(schema)) return;
  seen.add(schema);
  const meta = z.globalRegistry.get(schema);
  if (meta) into.add(schema, { ...meta });
  for (const child of children(schema)) copyMetadata(child, into, seen);
}

/**
 * JSON Schema (draft 2020-12) for course files (`CourseFile`), for importers. Checks structure and sizes only;
 * refinements such as reserved ids, address rules and the rich-text total are left to `parseCourseFile`.
 * docs/learning/course.schema.json is this, written with two-space indents.
 */
export function courseFileJsonSchema(): Record<string, unknown> {
  const metadata = z.registry<z.core.GlobalMeta>();
  copyMetadata(CourseFileSchema, metadata, new Set());
  for (const [schema, id] of NAMED) metadata.add(schema, { ...metadata.get(schema), id });
  metadata.add(IsoDateTimeSchema, {
    ...metadata.get(IsoDateTimeSchema),
    pattern: DATE_TIME_PATTERN,
  });
  metadata.add(CourseFileSchema, {
    title: 'Care Hub Learning course file',
    description: `Course format version ${COURSE_FORMAT_VERSION}. Generated from @carehub/learning; see docs/learning/course-format.md.`,
  });
  return z.toJSONSchema(CourseFileSchema, { metadata, io: 'input', target: 'draft-2020-12' });
}
