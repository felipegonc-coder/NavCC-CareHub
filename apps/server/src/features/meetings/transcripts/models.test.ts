import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isSafeModelName,
  listModelFiles,
  modelHeaders,
  modelsStatus,
  openModelFile,
} from './models';

describe('speech model files (MT-06)', () => {
  let root: string;
  let dir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'carehub-models-'));
    dir = join(root, 'models');
    await mkdir(join(dir, 'nested'), { recursive: true });
    await writeFile(join(dir, 'encoder.onnx'), Buffer.alloc(1_000, 1));
    await writeFile(join(dir, 'tokenizer.json'), '{"ok":true}');
    await writeFile(join(dir, '.hidden'), 'not served');
    await writeFile(join(dir, 'nested', 'decoder.onnx'), 'in a subfolder');
    await writeFile(join(root, 'secret.txt'), 'outside the folder');
    await symlink(join(root, 'secret.txt'), join(dir, 'linked.txt'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('allows plain file names only', () => {
    for (const name of ['encoder.onnx', 'whisper-base.en_q8.onnx', 'tokenizer.json']) {
      expect(isSafeModelName(name)).toBe(true);
    }
    for (const name of [
      '',
      '.hidden',
      '..',
      'a..b',
      '../secret.txt',
      'nested/decoder.onnx',
      'a b',
    ]) {
      expect(isSafeModelName(name)).toBe(false);
    }
    expect(isSafeModelName('a'.repeat(129))).toBe(false);
  });

  it('lists only the regular files directly in the folder', async () => {
    const files = await listModelFiles(dir);
    expect(files?.map((file) => file.name)).toEqual(['encoder.onnx', 'tokenizer.json']);
    expect(await listModelFiles(join(root, 'missing'))).toBeNull();
  });

  it('is available only with model files, and says how big they are', async () => {
    expect(await modelsStatus(dir)).toEqual({ available: true, bytes: 1_011 });
    expect(await modelsStatus(null)).toEqual({ available: false, bytes: 0 });
    expect(await modelsStatus(join(root, 'missing'))).toEqual({ available: false, bytes: 0 });
    expect(await modelsStatus(join(dir, 'nested'))).toEqual({ available: true, bytes: 14 });
    const empty = join(root, 'empty');
    await mkdir(empty);
    expect(await modelsStatus(empty)).toEqual({ available: false, bytes: 0 });
  });

  it('opens a model file, and nothing outside the folder', async () => {
    const opened = await openModelFile(dir, 'tokenizer.json');
    expect(opened?.size).toBe(11);
    expect((await opened!.handle.readFile()).toString()).toBe('{"ok":true}');
    await opened!.handle.close();
    for (const name of ['linked.txt', 'nested', '../secret.txt', '.hidden', 'missing.onnx']) {
      expect(await openModelFile(dir, name)).toBeNull();
    }
  });

  it('is kept by the browser for a year', async () => {
    const [encoder, tokenizer] = (await listModelFiles(dir))!;
    const headers = modelHeaders(encoder!);
    expect(headers['content-type']).toBe('application/octet-stream');
    expect(headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(headers.etag).toMatch(/^"[0-9a-z]+-[0-9a-z]+"$/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(modelHeaders(tokenizer!)['content-type']).toBe('application/json; charset=utf-8');
  });
});
