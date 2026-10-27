import { describe, expect, it } from 'vitest';
import { checkPublishable, sampleCourses } from '@carehub/learning';
import type { Block } from '@carehub/learning';
import { isStudioError } from './client';
import { createMemoryStudioClient } from './memory-client';
import type { MemoryStudioOptions } from './memory-client';

// Fictional data only.
function setup(extra: MemoryStudioOptions = {}) {
  let n = 0;
  let t = Date.parse('2026-10-27T09:00:00.000Z');
  return createMemoryStudioClient({
    newId: () => `id-${++n}`,
    now: () => new Date((t += 1000)),
    ...extra,
  });
}

const example = sampleCourses.find((c) => checkPublishable(c).length === 0);
const failsWith = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(isStudioError(error) ? error.code : error).toBe(code);
  return error;
};

describe('memory Studio client', () => {
  it('creates drafts from a type or an example', async () => {
    const client = setup();
    const blank = await client.createCourse({ type: 'standard', title: '  ' });
    expect(blank.course).toMatchObject({ id: 'id-1', title: 'Untitled course', type: 'standard' });
    expect(blank).toMatchObject({ revision: 1, liveVersion: null });

    expect(example).toBeDefined();
    if (!example) return;
    const copy = await client.createCourse({ type: 'standard', exampleId: example.id });
    expect(copy.course.title).toBe(example.title);
    expect(copy.course.id).not.toBe(example.id);
    await failsWith(client.createCourse({ type: 'standard', exampleId: 'gone' }), 'not_found');

    const list = await client.listCourses();
    expect(list.map((c) => [c.id, c.state, c.version])).toEqual([
      [copy.course.id, 'draft', null],
      ['id-1', 'draft', null],
    ]);
    expect((await client.listExamples()).length).toBe(sampleCourses.length);
  });

  it('checks the revision and the format on save', async () => {
    const client = setup();
    const { course, revision } = await client.createCourse({ type: 'standard', title: 'Refunds' });
    expect(
      await client.saveCourse(course.id, { ...course, title: 'Refunds 101' }, revision),
    ).toEqual({
      revision: 2,
    });
    await failsWith(client.saveCourse(course.id, course, revision), 'conflict');
    await failsWith(client.saveCourse(course.id, { ...course, title: '' }, 2), 'invalid');
    await failsWith(client.saveCourse('nope', course, 2), 'not_found');
    expect((await client.getCourse(course.id)).course.title).toBe('Refunds 101');
  });

  it('publishes, tracks changes, lists versions and rolls back', async () => {
    if (!example) return;
    const client = setup();
    const empty = await client.createCourse({ type: 'standard', title: 'Empty' });
    const refused = await failsWith(
      client.publish(empty.course.id, { notify: 'none' }),
      'cannot_publish',
    );
    expect(isStudioError(refused) && refused.problems.length).toBeGreaterThan(0);

    const { course, revision } = await client.createCourse({
      type: 'standard',
      exampleId: example.id,
    });
    expect(await client.publish(course.id, { notify: 'none', note: ' First ' })).toEqual({
      version: 1,
    });
    const state = async () => (await client.listCourses()).find((c) => c.id === course.id)?.state;
    expect(await state()).toBe('live');
    await client.saveCourse(course.id, { ...course, title: 'Greeting callers, again' }, revision);
    expect(await state()).toBe('changed');
    expect(await client.publish(course.id, { notify: 'tell' })).toEqual({ version: 2 });

    expect(await client.rollback(course.id, 1)).toEqual({ version: 3 });
    const versions = await client.listVersions(course.id);
    expect(versions.map((v) => [v.version, v.title, v.note])).toEqual([
      [3, course.title, 'Rolled back to version 1'],
      [2, 'Greeting callers, again', undefined],
      [1, course.title, 'First'],
    ]);
    const draft = await client.getCourse(course.id);
    expect(draft).toMatchObject({ revision: 3, liveVersion: 3, course: { title: course.title } });
    expect(await state()).toBe('live');
    await failsWith(client.rollback(course.id, 9), 'not_found');
  });

  it('duplicates as an unpublished copy and archives', async () => {
    if (!example) return;
    const client = setup();
    const { course } = await client.createCourse({ type: 'standard', exampleId: example.id });
    await client.publish(course.id, { notify: 'none' });
    const copy = await client.duplicate(course.id);
    expect(copy).toMatchObject({ title: `Copy of ${course.title}`, state: 'draft', version: null });

    expect(await client.archive(course.id)).toMatchObject({ archived: true });
    expect((await client.listCourses()).map((c) => c.id)).toEqual([copy.id]);
    expect((await client.listCourses({ archived: true })).map((c) => c.id)).toEqual([course.id]);
    await client.unarchive(course.id);
    expect((await client.listCourses()).length).toBe(2);
  });

  it('saves and deletes block templates', async () => {
    const client = setup();
    const blocks: Block[] = [{ id: 'b1', type: 'divider', style: 'line' }];
    const saved = await client.saveBlockTemplate({ name: ' Sign-off ', blocks });
    expect(saved).toEqual({ id: 'id-1', name: 'Sign-off', blocks });
    await failsWith(client.saveBlockTemplate({ name: ' ', blocks }), 'invalid');
    await failsWith(client.saveBlockTemplate({ name: 'None', blocks: [] }), 'invalid');
    expect(await client.listBlockTemplates()).toEqual([saved]);
    await client.deleteBlockTemplate(saved.id);
    expect(await client.listBlockTemplates()).toEqual([]);
    await failsWith(client.deleteBlockTemplate(saved.id), 'not_found');
  });

  it('keeps drafts in storage across reloads and ignores unreadable storage', async () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    const first = setup({ storage });
    const { course } = await first.createCourse({ type: 'microlearning', title: 'Hold music' });
    const again = setup({ storage });
    expect((await again.getCourse(course.id)).course).toEqual(course);

    data.set('carehub.learning.studio', '{not json');
    expect(await setup({ storage }).listCourses()).toEqual([]);
  });
});
