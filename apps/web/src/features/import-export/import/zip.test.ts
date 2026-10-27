import { readZip, readZipEntry } from '@carehub/databases/xlsx';
import { zipFile } from '@carehub/databases/xlsx/fixtures';
import { ImportFileError } from '@carehub/extras/import-export/import/index';
import { describe, expect, it } from 'vitest';
import { inflateRaw, openZip, zipParts } from './zip';

const encode = (text: string) => new TextEncoder().encode(text);

function joined(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

async function streamed(bytes: Uint8Array, transform: CompressionStream): Promise<Uint8Array> {
  const input = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes as Uint8Array<ArrayBuffer>);
      controller.close();
    },
  });
  const reader = input.pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    chunks.push(read.value);
  }
  return joined(chunks);
}

const deflate = (bytes: Uint8Array) => streamed(bytes, new CompressionStream('deflate-raw'));

describe('zips in the browser', () => {
  it("writes stored zips that the server's reader reads back", () => {
    const items = [
      { name: 'plan.json', bytes: encode('{"pages":[]}') },
      { name: 'files/picture-1', bytes: Uint8Array.of(0, 1, 2, 255) },
      { name: 'files/empty', bytes: new Uint8Array(0) },
    ];
    const read = readZip(joined(zipParts(items)));
    if (!read.ok) throw new Error(read.problem);
    expect(read.zip.entries.map(({ name, method, size }) => ({ name, method, size }))).toEqual([
      { name: 'plan.json', method: 0, size: 12 },
      { name: 'files/picture-1', method: 0, size: 4 },
      { name: 'files/empty', method: 0, size: 0 },
    ]);
    read.zip.entries.forEach((entry, index) => {
      const bytes = readZipEntry(read.zip, entry, () => new Uint8Array(0));
      expect(bytes).toEqual({ ok: true, bytes: items[index]?.bytes });
    });
  });

  it('reads stored and deflated entries, and text as the server does', async () => {
    const page = encode(`<h1>Trip</h1>${'<p>Beach day</p>'.repeat(200)}`);
    const packed = await deflate(page);
    const zip = openZip(
      zipFile([
        { name: 'Trip/index.html', data: page, deflate: () => packed },
        { name: 'Trip/', data: '' },
        { name: 'Notes.md', data: '# Café' },
        { name: 'Old.txt', data: Uint8Array.of(0x43, 0x61, 0x66, 0xe9) },
      ]),
    );
    expect(zip.names).toEqual(['Trip/index.html', 'Notes.md', 'Old.txt']);
    expect(await zip.read('Trip/index.html')).toEqual(page);
    expect(await zip.text('Notes.md')).toBe('# Café');
    expect(await zip.text('Old.txt')).toBe('Café');
  });

  it("refuses zips it can't open safely, in the server's words", async () => {
    const fails = (bytes: Uint8Array) => () => openZip(bytes);
    expect(fails(encode('<p>not a zip</p>'))).toThrow("the file isn't a zip");
    expect(fails(zipFile([{ name: 'a.md', data: 'x', flags: 1 }]))).toThrow(
      'the zip has a password',
    );
    const tight = {
      name: 'big.md',
      data: 'x',
      size: 2 * 1024 * 1024,
      deflate: () => encode('xyz'),
    };
    expect(fails(zipFile([tight]))).toThrow('the zip is packed too tightly to open safely');

    const zip = openZip(zipFile([{ name: 'a.md', data: 'x', crc: 1 }]));
    await expect(zip.read('a.md')).rejects.toThrow('the zip is damaged');
    await expect(zip.read('missing.md')).rejects.toBeInstanceOf(ImportFileError);
  });

  it('stops inflating past the size the zip gives', async () => {
    const text = encode('Beach day. '.repeat(50));
    const packed = await deflate(text);
    await expect(inflateRaw(packed, text.byteLength)).resolves.toEqual(text);
    await expect(inflateRaw(packed, 10)).rejects.toThrow();
    const zip = openZip(zipFile([{ name: 'a.md', data: text, size: 10, deflate: () => packed }]));
    await expect(zip.read('a.md')).rejects.toThrow('the zip is damaged');
    const broken = openZip(zipFile([{ name: 'b.md', data: text, deflate: () => encode('?!') }]));
    await expect(broken.read('b.md')).rejects.toThrow('the zip is damaged');
  });
});
