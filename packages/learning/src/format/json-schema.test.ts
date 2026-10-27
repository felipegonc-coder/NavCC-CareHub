import { describe, expect, it } from 'vitest';
import committed from '../../../../docs/learning/course.schema.json';
import { sampleCourses } from '../fixtures/index';
import { courseFileJsonSchema, toCourseFile } from './index';

/** Where two JSON values differ, one short `path: committed → generated` line each (at most 40). */
function differences(
  committed: unknown,
  generated: unknown,
  path = '$',
  out: string[] = [],
): string[] {
  if (out.length >= 40 || Object.is(committed, generated)) return out;
  const show = (value: unknown) => (JSON.stringify(value) ?? 'missing').slice(0, 200);
  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;
  if (
    !isObject(committed) ||
    !isObject(generated) ||
    Array.isArray(committed) !== Array.isArray(generated)
  ) {
    out.push(`${path}: ${show(committed)} → ${show(generated)}`);
    return out;
  }
  for (const key of new Set([...Object.keys(committed), ...Object.keys(generated)])) {
    const at = Array.isArray(committed) ? `${path}[${key}]` : `${path}.${key}`;
    differences(committed[key], generated[key], at, out);
  }
  return out;
}

describe('course file JSON Schema', () => {
  it('matches docs/learning/course.schema.json', () => {
    // If this fails after a schema change, write JSON.stringify(courseFileJsonSchema(), null, 2) to
    // docs/learning/course.schema.json and run Prettier on it. The lines below say what changed.
    expect(differences(committed, courseFileJsonSchema())).toEqual([]);
  });

  it('reports differences by path', () => {
    expect(differences({ a: [1, { b: 'x' }], c: true }, { a: [1, { b: 'y' }], d: 1 })).toEqual([
      '$.a[1].b: "x" → "y"',
      '$.c: true → missing',
      '$.d: missing → 1',
    ]);
  });

  it('names the shared shapes and rejects unknown keys', () => {
    const schema = courseFileJsonSchema() as {
      $defs: Record<string, { additionalProperties?: boolean }>;
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.$defs).sort()).toEqual([
      'Block',
      'Course',
      'ExternalId',
      'Id',
      'Image',
      'Lesson',
      'MediaRef',
      'Question',
      'RichText',
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.Course?.additionalProperties).toBe(false);
  });

  it('is plain JSON', () => {
    expect(JSON.parse(JSON.stringify(courseFileJsonSchema()))).toEqual(courseFileJsonSchema());
    expect(sampleCourses.map((course) => toCourseFile(course).format)).toContain(
      'carehub.learning.course',
    );
  });
});
