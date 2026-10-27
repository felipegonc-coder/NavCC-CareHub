import { randomUUID } from 'node:crypto';
import { sampleStandardCourse } from '@carehub/learning';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../../db';
import { createTestApp, hasDatabase, type TestApp } from '../../../testing';
import { LearningError } from '../errors';
import { learningBlockTemplates } from './schema';
import type { Actor } from './service';
import * as templates from './templates';

const someone = (): Actor => ({ userId: randomUUID(), workspaceId: randomUUID() });

async function failure(call: Promise<unknown>): Promise<LearningError> {
  const outcome = await call.then(
    () => new Error('Expected the call to fail.'),
    (error: unknown) => error,
  );
  if (outcome instanceof LearningError) return outcome;
  throw outcome;
}

const [lesson] = sampleStandardCourse.lessons;
if (lesson?.kind !== 'content') throw new Error('The sample course starts with a content lesson.');
const blocks = structuredClone(lesson.blocks.slice(0, 2));

describe.skipIf(!hasDatabase)('Block templates', () => {
  let server: TestApp;
  let db: Db;

  beforeAll(async () => {
    server = await createTestApp();
    db = server.db;
  });

  afterAll(async () => {
    await server?.close();
  });

  it('saves, lists newest first and deletes templates, only in their own workspace', async () => {
    const actor = someone();
    const greeting = await templates.createBlockTemplate(db, actor, { name: 'Greeting', blocks });
    expect(greeting).toEqual({
      id: expect.any(String),
      name: 'Greeting',
      blocks,
      createdAt: expect.any(String),
    });
    const closing = await templates.createBlockTemplate(db, actor, {
      name: 'Closing',
      blocks: blocks.slice(0, 1),
    });
    const names = async () => (await templates.listBlockTemplates(db, actor)).map((t) => t.name);
    expect(await names()).toEqual(['Closing', 'Greeting']);

    const outsider = someone();
    expect(await templates.listBlockTemplates(db, outsider)).toEqual([]);
    expect(await failure(templates.deleteBlockTemplate(db, outsider, greeting.id))).toMatchObject({
      status: 404,
    });

    await templates.deleteBlockTemplate(db, actor, greeting.id);
    expect(await names()).toEqual([closing.name]);
    expect(await failure(templates.deleteBlockTemplate(db, actor, greeting.id))).toMatchObject({
      status: 404,
    });
  });

  it('keeps at most 200 templates in a workspace', async () => {
    const actor = someone();
    await db.insert(learningBlockTemplates).values(
      Array.from({ length: 200 }, (_, index) => ({
        workspaceId: actor.workspaceId,
        id: `template-${index}`,
        name: `Template ${index}`,
        blocks,
        createdBy: actor.userId,
      })),
    );
    const full = await failure(
      templates.createBlockTemplate(db, actor, { name: 'One more', blocks }),
    );
    expect(full).toMatchObject({ status: 400, code: 'invalid' });
    expect(full.message).toMatch(/200 block templates/);
    expect(await templates.listBlockTemplates(db, actor)).toHaveLength(200);
  });
});
