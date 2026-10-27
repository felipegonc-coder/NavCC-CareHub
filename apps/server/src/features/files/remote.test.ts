import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { downloadRemoteFile, isPublicAddress, RemoteError, type RemoteOptions } from './remote';

const PNG = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001', 'hex');

/** Why a download failed, or "downloaded". */
async function failure(address: string, options?: RemoteOptions) {
  try {
    await downloadRemoteFile(address, options);
    return 'downloaded';
  } catch (error) {
    return error instanceof RemoteError ? { reason: error.reason, detail: error.detail } : error;
  }
}

describe('isPublicAddress', () => {
  it('refuses private, loopback, link-local, tailnet and reserved addresses', () => {
    const refused = [
      ...['0.0.0.0', '10.1.2.3', '100.64.0.1', '100.101.102.103', '100.127.255.255', '127.0.0.1'],
      ...['127.8.9.10', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.8'],
      ...['192.0.2.10', '192.168.1.20', '198.18.0.1', '198.51.100.7', '203.0.113.9', '224.0.0.251'],
      ...['239.255.255.250', '240.0.0.1', '255.255.255.255', '::', '::1', 'fe80::1', 'fc00::1'],
      ...['fd7a:115c:a1e0::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1'],
      ...['::127.0.0.1', '64:ff9b::a00:1', '64:ff9b:1::1', '100::1', '2001::1', '2001:db8::1'],
      ...['2002:a00:1::1', '3fff::1', 'pictures.example', ''],
    ];
    expect(refused.filter(isPublicAddress)).toEqual([]);
  });

  it('lets public addresses through', () => {
    const allowed = [
      ...['1.1.1.1', '8.8.8.8', '100.63.255.255', '100.128.0.1', '172.32.0.1', '192.169.0.1'],
      ...['2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:1.1.1.1', '64:ff9b::808:808'],
      '2002:808:808::1',
    ];
    expect(allowed.filter((address) => !isPublicAddress(address))).toEqual([]);
  });
});

describe('downloadRemoteFile', () => {
  let server: Server;
  let base = '';
  let port = 0;
  let requests = 0;
  // The test server's address may be reached; everything else is checked as in production.
  const local: RemoteOptions = {
    isAllowedAddress: (address) => address === '127.0.0.1',
    isAllowedPort: () => true,
    maxBytes: 1000,
    timeoutMs: 300,
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests += 1;
      const answers: Record<string, () => void> = {
        '/photos/Harbour%20at%20dusk.png': () => response.writeHead(200).end(PNG),
        '/moved': () =>
          response.writeHead(302, { location: '/photos/Harbour%20at%20dusk.png' }).end(),
        '/loop': () => response.writeHead(301, { location: '/loop' }).end(),
        '/to-private': () => response.writeHead(307, { location: 'http://10.0.0.8/a.png' }).end(),
        '/missing': () => response.writeHead(404).end('Not here.'),
        '/big': () => response.writeHead(200, { 'content-length': '2000' }).end(Buffer.alloc(2000)),
        '/big-unannounced': () => {
          response.writeHead(200);
          response.write(Buffer.alloc(600));
          setTimeout(() => response.end(Buffer.alloc(600)), 20);
        },
        '/slow': () => undefined,
      };
      (answers[request.url ?? ''] ?? (() => response.writeHead(404).end()))();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('downloads a file and names it from its address', async () => {
    const file = await downloadRemoteFile(`${base}/photos/Harbour%20at%20dusk.png`, local);
    expect(file.name).toBe('Harbour at dusk.png');
    expect(file.bytes.equals(PNG)).toBe(true);
  });

  it('follows redirects, checking each one', async () => {
    expect((await downloadRemoteFile(`${base}/moved`, local)).name).toBe('Harbour at dusk.png');
    expect(await failure(`${base}/to-private`, local)).toEqual({ reason: 'not_public' });
    expect(await failure(`${base}/loop`, local)).toEqual({ reason: 'redirects' });
  });

  it('refuses error answers, files over the limit and slow websites', async () => {
    expect(await failure(`${base}/missing`, local)).toEqual({ reason: 'status', detail: 404 });
    expect(await failure(`${base}/big`, local)).toEqual({ reason: 'too_large', detail: 2000 });
    expect(await failure(`${base}/big-unannounced`, local)).toEqual({ reason: 'too_large' });
    const started = Date.now();
    expect(await failure(`${base}/slow`, local)).toEqual({ reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('never connects to local, private or tailnet addresses, by name or by number', async () => {
    const before = requests;
    const anyPort = { isAllowedPort: () => true };
    for (const address of [
      `${base}/photos/Harbour%20at%20dusk.png`,
      `http://localhost:${port}/photos/Harbour%20at%20dusk.png`,
      `http://[::1]:${port}/a.png`,
      `http://[::ffff:127.0.0.1]:${port}/a.png`,
      `http://2130706433:${port}/a.png`,
      'http://10.0.0.8/a.png',
      'http://100.100.100.100/a.png',
      'http://169.254.169.254/latest/meta-data/',
    ]) {
      expect([address, await failure(address, anyPort)]).toEqual([
        address,
        { reason: 'not_public' },
      ]);
    }
    expect(requests).toBe(before);
  });

  it('refuses a name when any of its addresses is private, and connects to the one it checked', async () => {
    const mixed = async () => [
      { address: '1.1.1.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ];
    expect(await failure('https://pictures.example/a.png', { resolve: mixed })).toEqual({
      reason: 'not_public',
    });
    const toServer = { ...local, resolve: async () => [{ address: '127.0.0.1', family: 4 }] };
    const file = await downloadRemoteFile(`http://pictures.example:${port}/moved`, toServer);
    expect(file.name).toBe('Harbour at dusk.png');
  });

  it('takes only web addresses, on the web ports', async () => {
    for (const address of [
      'ftp://pictures.example/a.png',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'pictures.example/a.png',
      'https://someone:secret@pictures.example/a.png',
    ]) {
      expect([address, await failure(address)]).toEqual([address, { reason: 'address' }]);
    }
    expect(await failure('https://pictures.example:8443/a.png')).toEqual({ reason: 'not_public' });
  });

  it('says when a name does not exist', async () => {
    const missing = async () => {
      throw Object.assign(new Error('Not found.'), { code: 'ENOTFOUND' });
    };
    expect(await failure('https://missing.example/a.png', { resolve: missing })).toEqual({
      reason: 'not_found',
    });
  });
});
