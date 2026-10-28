import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestApp,
  createUser,
  hasDatabase,
  injectAs,
  type TestApp,
  type TestUser,
} from '../../../testing';
import transcriptsRoutes from './routes';

// Their own prefixes, so these tests run the same once meetings is registered in app.ts.
const API = '/api/test-transcription';
const OFF = '/api/test-transcription-off';

describe.skipIf(!hasDatabase)('transcription routes on Postgres', () => {
  let test: TestApp;
  let avery: TestUser;
  let casey: TestUser;
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'carehub-transcription-'));
    const models = join(root, 'models');
    await mkdir(join(models, 'nested'), { recursive: true });
    await writeFile(join(models, 'encoder.onnx'), Buffer.alloc(2_048, 7));
    await writeFile(join(models, 'tokenizer.json'), '{"vocab":[]}');
    await writeFile(join(models, 'nested', 'decoder.onnx'), 'in a subfolder');
    await writeFile(join(root, 'secret.txt'), 'outside the folder');
    await symlink(join(root, 'secret.txt'), join(models, 'linked.txt'));
    test = await createTestApp({
      routes: async (app) => {
        await app.register(transcriptsRoutes, { prefix: API, modelsDir: models });
        await app.register(transcriptsRoutes, { prefix: OFF, modelsDir: null });
      },
    });
    avery = await createUser(test.db, { name: 'Avery Lin', email: 'avery.lin@example.com' });
    casey = await createUser(test.db, {
      kind: 'guest',
      name: 'Casey Nguyen',
      email: 'casey.nguyen@example.com',
    });
  });

  afterAll(async () => {
    await test?.close();
    await rm(root, { recursive: true, force: true });
  });

  const get = (who: TestUser, url: string, headers: Record<string, string> = {}) =>
    injectAs(test.app, who, { method: 'GET', url, headers });

  it('says whether transcription is set up, and how big the download is (MT-06)', async () => {
    expect((await get(avery, `${API}/transcription`)).json()).toEqual({
      available: true,
      bytes: 2_060,
    });
    expect((await get(avery, `${OFF}/transcription`)).json()).toEqual({
      available: false,
      bytes: 0,
      message: "Transcription isn't set up yet.",
    });
    expect((await get(casey, `${API}/transcription`)).statusCode).toBe(403);
  });

  it('serves the model files from their folder only, kept for a year', async () => {
    const model = await get(avery, `${API}/models/encoder.onnx`);
    expect(model.statusCode).toBe(200);
    expect(model.rawPayload.length).toBe(2_048);
    expect(model.headers['content-type']).toBe('application/octet-stream');
    expect(model.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(model.headers['x-content-type-options']).toBe('nosniff');
    const etag = String(model.headers.etag);
    const cached = await get(avery, `${API}/models/encoder.onnx`, { 'if-none-match': etag });
    expect(cached.statusCode).toBe(304);
    const tokenizer = await get(avery, `${API}/models/tokenizer.json`);
    expect(tokenizer.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(tokenizer.body).toBe('{"vocab":[]}');
    const refused = [
      'linked.txt',
      '..%2Fsecret.txt',
      '%2E%2E%2Fsecret.txt',
      'nested%2Fdecoder.onnx',
      'nested/decoder.onnx',
      'nested',
      'missing.onnx',
    ];
    for (const name of refused) {
      expect((await get(avery, `${API}/models/${name}`)).statusCode).toBe(404);
    }
    expect((await get(avery, `${OFF}/models/encoder.onnx`)).statusCode).toBe(404);
    expect((await get(casey, `${API}/models/encoder.onnx`)).statusCode).toBe(403);
  });
});
