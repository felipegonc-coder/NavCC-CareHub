import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { utf8, zipFile } from '@carehub/databases/xlsx/fixtures';
import { build } from 'esbuild';
import { ImportFileError } from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { readInWorker } from './isolate';
import type { ReadRequest } from './read';

const request: ReadRequest = {
  source: 'markdown',
  fileName: 'notes.md',
  bytes: utf8('# Notes'),
  planned: false,
};

const folder = mkdtempSync(join(tmpdir(), 'carehub-import-'));
/** A stand-in worker script: `body` runs with parentPort and workerData in scope. */
function workerScript(name: string, body: string): URL {
  const file = join(folder, `${name}.mjs`);
  writeFileSync(file, `import { parentPort, workerData } from 'node:worker_threads';\n${body}\n`);
  return pathToFileURL(file);
}

describe('readInWorker', () => {
  it('reads here when there is no bundled worker, outside production', async () => {
    const { plan } = await readInWorker(request, { workerFile: null, production: false });
    expect(plan.pages.map((page) => page.title)).toEqual(['Notes']);
  });

  it('refuses to read without the bundled worker in production', async () => {
    const error = await readInWorker(request, { workerFile: null, production: true }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ImportFileError);
    expect((error as Error).message).toBe("the file can't be read right now");
  });

  it('reads in the bundled worker thread', async () => {
    const outfile = join(folder, 'import-worker.mjs');
    await build({
      entryPoints: [new URL('./worker.ts', import.meta.url).pathname],
      outfile,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node24',
      logLevel: 'silent',
    });
    const deflate = (data: Uint8Array) => new Uint8Array(deflateRawSync(data));
    const bytes = zipFile([{ name: 'Intake guide.md', data: '# Intake guide', deflate }]);
    const { plan } = await readInWorker(
      { ...request, fileName: 'handbook.zip', bytes },
      { workerFile: pathToFileURL(outfile) },
    );
    expect(plan.pages.map((page) => page.title)).toEqual(['Intake guide']);
  });

  it('gives back what the worker read', async () => {
    const workerFile = workerScript(
      'answers',
      'parentPort.postMessage({ ok: true, result: { plan: { pages: [], databases: [], files: [], problems: [] }, files: [workerData.bytes] } });',
    );
    const { files } = await readInWorker(request, { workerFile });
    expect(files).toEqual([utf8('# Notes')]);
  });

  it("passes on the worker's reason, and hides the others", async () => {
    const said = workerScript(
      'refuses',
      "parentPort.postMessage({ ok: false, reason: 'the zip is damaged' });",
    );
    await expect(readInWorker(request, { workerFile: said })).rejects.toThrow('the zip is damaged');
    const crashes = workerScript('crashes', "throw new Error('secret text from the file');");
    const error = await readInWorker(request, { workerFile: crashes }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportFileError);
    expect((error as Error).message).toBe("the file couldn't be read");
  });

  it('stops a worker that runs too long, or when cancelled', async () => {
    const workerFile = workerScript('hangs', 'setInterval(() => {}, 1000);');
    await expect(readInWorker(request, { workerFile, timeoutMs: 100 })).rejects.toThrow(
      'reading the file took too long',
    );
    const controller = new AbortController();
    const reading = readInWorker(request, { workerFile, signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await expect(reading).rejects.toThrow('cancelled');
  });
});
