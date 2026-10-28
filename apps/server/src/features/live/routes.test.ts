import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerEvents } from '../../core/events';
import { createLiveHub, type LiveHub } from './domain/hub';
import { parseFrames, testSink } from './domain/testSink';
import liveRoutes from './routes';

let app: FastifyInstance | undefined;
let hub: LiveHub;

async function build(options: { events?: boolean } = {}): Promise<FastifyInstance> {
  hub = createLiveHub();
  hub.registerTopic('chat', async ({ userId }) => userId === 'user-avery');
  app = Fastify();
  if (options.events) registerEvents(app);
  await app.register(liveRoutes, {
    prefix: '/api/live',
    hub,
    getUserId: (request) => {
      const user = request.headers['x-test-user'];
      return typeof user === 'string' ? user : null;
    },
  });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /api/live/topics', () => {
  it('adds and removes topics for your own connection', async () => {
    const api = await build();
    const { id } = hub.connect('user-avery', testSink().sink);
    const added = await api.inject({
      method: 'POST',
      url: '/api/live/topics',
      headers: { 'x-test-user': 'user-avery' },
      payload: { connectionId: id, add: ['chat:c1', 'db:p1'] },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json()).toEqual({
      results: [
        { topic: 'chat:c1', ok: true },
        { topic: 'db:p1', ok: false },
      ],
    });
    const removed = await api.inject({
      method: 'POST',
      url: '/api/live/topics',
      headers: { 'x-test-user': 'user-avery' },
      payload: { connectionId: id, remove: ['chat:c1'] },
    });
    expect(removed.json()).toEqual({ results: [{ topic: 'chat:c1', ok: true }] });
  });

  it('refuses signed-out requests, bad bodies and other people’s connections', async () => {
    const api = await build();
    const { id } = hub.connect('user-avery', testSink().sink);
    const post = (user: string | null, payload: unknown) =>
      api.inject({
        method: 'POST',
        url: '/api/live/topics',
        headers: user ? { 'x-test-user': user } : {},
        payload: payload as Record<string, unknown>,
      });
    const signedOut = await post(null, { connectionId: id });
    expect(signedOut.statusCode).toBe(401);
    expect(signedOut.json()).toEqual({
      error: { code: 'signed_out', message: 'Sign in to continue.' },
    });
    const noConnection = await post('user-avery', { add: ['chat:c1'] });
    expect(noConnection.statusCode).toBe(400);
    expect(noConnection.json()).toMatchObject({ error: { code: 'invalid' } });
    const { error } = noConnection.json() as { error: { details: { path: unknown[] }[] } };
    expect(error.details[0]).toMatchObject({ path: ['connectionId'] });
    expect((await post('user-avery', { connectionId: id, add: 'chat:c1' })).statusCode).toBe(400);
    const notYours = await post('user-sam', { connectionId: id, add: ['chat:c1'] });
    expect(notYours.statusCode).toBe(404);
    expect(notYours.json()).toEqual({
      error: { code: 'not_found', message: 'This was deleted, or the link is wrong.' },
    });
  });
});

describe('GET /api/live', () => {
  it('needs a signed-in user', async () => {
    const api = await build();
    const response = await api.inject({ method: 'GET', url: '/api/live' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: 'signed_out', message: 'Sign in to continue.' },
    });
  });

  it('streams hello first, and closing the app ends the stream', async () => {
    const api = await build();
    const address = await api.listen({ port: 0, host: '127.0.0.1' });
    const response = await fetch(`${address}/api/live`, {
      headers: { 'x-test-user': 'user-avery' },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!text.includes('\n\n')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    const [hello] = parseFrames(text);
    expect(hello).toMatchObject({ event: 'hello', retry: 3000 });
    expect(hub.stats()).toMatchObject({ connections: 1, users: 1 });
    const closing = api.close();
    let done = false;
    while (!done) done = (await reader.read()).done;
    await closing;
    app = undefined;
    expect(hub.stats().connections).toBe(0);
  });
});

describe('someone taken out of the workspace', () => {
  it('loses every open stream at once', async () => {
    const api = await build({ events: true });
    const tabs = [testSink(), testSink(), testSink()];
    hub.connect('user-avery', tabs[0]!.sink);
    hub.connect('user-avery', tabs[1]!.sink);
    hub.connect('user-sam', tabs[2]!.sink);
    api.events.emit('member.removed', { workspaceId: 'workspace-1', userId: 'user-avery' });
    await api.events.settled();
    expect(tabs.map((tab) => tab.ended)).toEqual([true, true, false]);
    expect(hub.hasOpenTabs('user-sam')).toBe(true);
  });
});
