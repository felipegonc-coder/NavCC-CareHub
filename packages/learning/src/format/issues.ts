import type { z } from 'zod';

/** A problem found while reading a course, path or file. `path` looks like `lessons[0].blocks[3].text` ("" = the whole thing). */
export type FormatIssue = { path: string; message: string };

/** The result of reading untrusted input. Never thrown: problems come back as issues. */
export type ParseResult<T> = { ok: true; value: T } | { ok: false; issues: FormatIssue[] };

/** At most this many issues are returned; one more says how many were left out. */
export const MAX_ISSUES = 100;

/** Writes a zod path the way people read it: `["lessons", 0, "title"]` becomes `lessons[0].title`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else if (typeof key === 'string' && /^[A-Za-z_$][\w$]*$/.test(key))
      out += out === '' ? key : `.${key}`;
    else out += `[${JSON.stringify(String(key))}]`;
  }
  return out;
}

const quote = (value: unknown) => JSON.stringify(value) ?? String(value);
const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
const KINDS: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'true or false',
  object: 'an object',
  array: 'a list',
};

/** Plain-language messages for zod issues that have no message of their own (schema messages win). */
export function readableMessage(issue: z.core.$ZodRawIssue): string | undefined {
  const input: unknown = issue.input;
  switch (issue.code) {
    case 'invalid_type':
      if (input === undefined) return 'Required.';
      return `Must be ${KINDS[issue.expected] ?? issue.expected}.`;
    case 'too_small': {
      const min = Number(issue.minimum);
      if (issue.origin === 'string')
        return min === 1
          ? "Can't be empty."
          : `Must be at least ${plural(min, 'character', 'characters')}.`;
      if (issue.origin === 'array') return `Needs at least ${plural(min, 'item', 'items')}.`;
      return issue.inclusive ? `Must be at least ${min}.` : `Must be more than ${min}.`;
    }
    case 'too_big': {
      const max = Number(issue.maximum);
      if (issue.origin === 'string' && typeof input === 'string') {
        return `Must be at most ${plural(max, 'character', 'characters')} (this has ${input.length.toLocaleString('en-US')}).`;
      }
      if (issue.origin === 'array' && Array.isArray(input)) {
        return `Can have at most ${plural(max, 'item', 'items')} (this has ${input.length.toLocaleString('en-US')}).`;
      }
      return issue.inclusive ? `Must be at most ${max}.` : `Must be less than ${max}.`;
    }
    case 'invalid_value':
      return issue.values.length === 1
        ? `Must be ${quote(issue.values[0])}.`
        : `Must be one of ${issue.values.map(quote).join(', ')}.`;
    case 'unrecognized_keys':
      return issue.keys.length === 1
        ? `Unknown field ${quote(issue.keys[0])}.`
        : `Unknown fields ${issue.keys.map(quote).join(', ')}.`;
    case 'invalid_union': {
      const { discriminator, options } = issue as { discriminator?: unknown; options?: unknown };
      if (typeof discriminator === 'string' && Array.isArray(options)) {
        const value =
          input !== null && typeof input === 'object'
            ? (input as Record<string, unknown>)[discriminator]
            : undefined;
        const allowed = `Use one of ${options.map(quote).join(', ')}.`;
        return value === undefined
          ? `Missing ${quote(discriminator)}. ${allowed}`
          : `Unknown ${discriminator} ${quote(value)}. ${allowed}`;
      }
      return "Doesn't match any of the allowed shapes.";
    }
    case 'invalid_key':
      return issue.issues[0]?.message ?? 'Not a valid key.';
    case 'invalid_format':
      return 'Has the wrong format.';
    default:
      return undefined;
  }
}

/** Turns zod issues into `FormatIssue`s, capped at `MAX_ISSUES`. */
export function toFormatIssues(
  issues: readonly z.core.$ZodIssue[],
  prefix: readonly PropertyKey[] = [],
): FormatIssue[] {
  const out = issues
    .slice(0, MAX_ISSUES)
    .map((issue) => ({ path: formatPath([...prefix, ...issue.path]), message: issue.message }));
  if (issues.length > MAX_ISSUES)
    out.push({
      path: '',
      message: `${(issues.length - MAX_ISSUES).toLocaleString('en-US')} more problems not shown.`,
    });
  return out;
}

/** Validates untrusted input with readable messages. Never throws. */
export function parseWith<S extends z.ZodType>(schema: S, raw: unknown): ParseResult<z.output<S>> {
  try {
    const result = schema.safeParse(raw, { error: readableMessage });
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, issues: toFormatIssues(result.error.issues) };
  } catch {
    return { ok: false, issues: [{ path: '', message: 'This could not be read.' }] };
  }
}
