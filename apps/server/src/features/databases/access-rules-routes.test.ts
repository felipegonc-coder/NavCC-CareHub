// Row access rules and live updates on a real database (decision 0200): PUT /:id/access-rules for
// Full access only, and schema-changed on db:<id> for the people who may listen. Fictional people
// only.
import { defaultConfig, type Property, type RowAccessRule } from '@carehub/databases';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createUser, hasDatabase, type TestUser } from '../../testing';
import { liveHub } from '../live';
import { INVALID, testWorkspace, type TestWorkspace } from './test-workspace';

type Answer = { version: number; properties: Property[]; accessRules: RowAccessRule[] };

describe.skipIf(!hasDatabase)('access rules and live updates', () => {
  let ws: TestWorkspace;
  const people = {} as Record<'admin' | 'avery' | 'jordan', TestUser>;
  let jobs: string;
  /** The Jobs database's version as last answered. */
  let version: number;
  let crew: Property;

  const url = (rest = '') => `/api/databases/${jobs}${rest}`;
  const putRules = (who: TestUser, payload: object) =>
    ws.send(who, 'PUT', url('/access-rules'), payload);
  const took = (answer: Answer): Answer => {
    version = answer.version;
    return answer;
  };
  /** An open tab for this person: the frames it got so far. */
  const openTab = () => {
    const frames: string[] = [];
    return { frames, sink: { write: (frame: string) => frames.push(frame) > 0, end: () => {} } };
  };
  const schemaChanges = (frames: readonly string[]) =>
    frames.filter((frame) => frame.includes('"type":"schema-changed"')).length;
  const settled = () => new Promise((resolve) => setImmediate(resolve));

  beforeAll(async () => {
    ws = await testWorkspace();
    people.admin = await ws.person('admin', 'Morgan Reyes');
    people.avery = await ws.person('editor', 'Avery Lin');
    people.jordan = await ws.person('viewer', 'Jordan Park');
    const made = await ws.send(people.avery, 'POST', '/api/databases', {
      parentId: ws.pageId,
      inline: false,
      title: 'Jobs',
    });
    jobs = made.json().id;
    version = made.json().version;
    const added = await ws.send(people.avery, 'POST', url('/properties'), {
      version,
      name: 'Crew',
      config: defaultConfig('person'),
    });
    crew = took(added.json()).properties.find((p) => p.name === 'Crew')!;
  });

  afterAll(async () => {
    await ws?.close();
  });

  it('saves row access rules for Full access only', async () => {
    const rules = [{ id: 'crew-edits', propertyId: crew.id, level: 'edit' }];
    expect((await putRules(people.avery, { version, rules })).statusCode).toBe(403);
    expect((await putRules(people.jordan, { version, rules })).statusCode).toBe(403);
    const saved = await putRules(people.admin, { version, rules });
    expect(saved.statusCode).toBe(200);
    const body = took(saved.json());
    expect(body.accessRules).toEqual(rules);
    const avery: Answer = (await ws.send(people.avery, 'GET', url())).json();
    expect(avery.accessRules).toEqual([]);

    const same = await putRules(people.admin, { version, rules });
    expect(same.json().version).toBe(version);
    const stale = await putRules(people.admin, { version: version - 1, rules: [] });
    expect(stale.statusCode).toBe(409);
    const bad = await putRules(people.admin, { version, rules: 'everyone' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual(INVALID);
    const name = body.properties.find((p) => p.config.type === 'title')!;
    const onName = await putRules(people.admin, {
      version,
      rules: [{ id: 'name', propertyId: name.id, level: 'view' }],
    });
    expect(onName.statusCode).toBe(400);
    expect(onName.json()).toEqual({
      error: { code: 'invalid', message: 'Rules can only use a Person or Created by property.' },
    });
  });

  it('tells the open tabs of people who can open the database when its settings change', async () => {
    const jordan = openTab();
    const tab = liveHub.connect(people.jordan.id, jordan.sink);
    const topic = `db:${jobs}`;
    const listening = await liveHub.updateTopics({
      userId: people.jordan.id,
      connectionId: tab.id,
      add: [topic],
    });
    expect(listening?.results).toEqual([{ topic, ok: true }]);
    const outsider = await createUser(ws.db, { name: 'Sam Ortiz' });
    const other = liveHub.connect(outsider.id, openTab().sink);
    const refused = await liveHub.updateTopics({
      userId: outsider.id,
      connectionId: other.id,
      add: [topic],
    });
    expect(refused?.results).toEqual([{ topic, ok: false }]);

    const cleared = await putRules(people.admin, { version, rules: [] });
    expect(cleared.statusCode).toBe(200);
    took(cleared.json());
    await settled();
    expect(schemaChanges(jordan.frames)).toBe(1);
    const same = await putRules(people.admin, { version, rules: [] });
    expect(same.json().version).toBe(version);
    const renamed = await ws.send(people.avery, 'PATCH', url(`/properties/${crew.id}`), {
      version,
      name: 'Crew lead',
    });
    expect(renamed.statusCode).toBe(200);
    await settled();
    expect(schemaChanges(jordan.frames)).toBe(2);
    tab.disconnect();
    other.disconnect();
  });
});
