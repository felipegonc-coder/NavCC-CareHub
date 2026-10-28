import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A local stand-in for Anthropic's Messages API, so browser tests never reach Claude
// (docs/extras/testing.md#claude). The server finds it through ANTHROPIC_BASE_URL, which accepts only
// loopback addresses, and the stub listens only on 127.0.0.1. Answers are canned and predictable.
// Run it with startClaudeStub(), or as a process: node tests/e2e/extras/claude-stub.ts

/** The answer to an ordinary request. */
export const STUB_TEXT = 'Suggested text from the Claude test stub.';

/** The answer when the request asks for one JSON value: a meeting summary. */
export const STUB_JSON = {
  summary: 'The team agreed the fictional weekly huddle moves to Tuesdays.',
  decisions: ['The huddle moves to Tuesdays.'],
  actionItems: [{ text: 'Update the huddle invite.', owner: 'Sam Rivera', due: '2026-11-03' }],
};

export const DEFAULT_STUB_PORT = 4599;
/** How long a STUB-SLOW request waits: longer than the server's 30 s timeout. */
export const SLOW_MS = 35_000;

const SECRET_HEADERS = new Set(['x-api-key', 'authorization']);
const JSON_REQUEST = 'Answer with one JSON value';

export interface StubRequest {
  time: string;
  method: string;
  path: string;
  /** Every header, with the key's value replaced by "<present>". */
  headers: Record<string, string>;
  body: unknown;
}

export interface ClaudeStub {
  url: string;
  requests(): StubRequest[];
  clear(): void;
  /** The next answer's text, used once; answers queue up in order. */
  answerNext(text: string): void;
  close(): Promise<void>;
}

export interface ClaudeStubOptions {
  port?: number;
  slowMs?: number;
}

export async function startClaudeStub(options: ClaudeStubOptions = {}): Promise<ClaudeStub> {
  const recorded: StubRequest[] = [];
  const queued: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const slowMs = options.slowMs ?? SLOW_MS;
  let count = 0;

  const server = http.createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (raw += chunk));
    request.on('end', () => {
      const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        if (response.destroyed || response.writableEnded) return;
        response.writeHead(status, { 'content-type': 'application/json', ...headers });
        response.end(body === undefined ? undefined : JSON.stringify(body));
      };

      if (pathname === '/__requests') {
        if (request.method === 'GET') return send(200, recorded);
        if (request.method === 'DELETE') {
          recorded.length = 0;
          return send(204, undefined);
        }
      }
      if (pathname === '/__answers' && request.method === 'POST') {
        const text = (parse(raw) as { text?: unknown } | undefined)?.text;
        if (typeof text !== 'string') return send(400, error('invalid_request_error'));
        queued.push(text);
        return send(204, undefined);
      }

      recorded.push({
        time: new Date().toISOString(),
        method: request.method ?? '',
        path: pathname,
        headers: redact(request.headers),
        body: parse(raw) ?? raw,
      });
      if (request.method !== 'POST' || pathname !== '/v1/messages') {
        return send(404, error('not_found_error'));
      }
      if (!request.headers['x-api-key']) return send(401, error('authentication_error'));
      if (!request.headers['anthropic-version']) return send(400, error('invalid_request_error'));
      if (raw.includes('STUB-429'))
        return send(429, error('rate_limit_error'), { 'retry-after': '1' });
      if (raw.includes('STUB-500')) return send(500, error('api_error'));

      count += 1;
      const body = parse(raw) as { model?: unknown } | undefined;
      const text =
        queued.shift() ?? (raw.includes(JSON_REQUEST) ? JSON.stringify(STUB_JSON) : STUB_TEXT);
      const answer = {
        id: `msg_stub_${count}`,
        type: 'message',
        role: 'assistant',
        model: typeof body?.model === 'string' ? body.model : 'claude-stub',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: Math.ceil(raw.length / 4),
          output_tokens: Math.ceil(text.length / 4),
        },
      };
      if (!raw.includes('STUB-SLOW')) return send(200, answer);
      const timer = setTimeout(() => {
        timers.delete(timer);
        send(200, answer);
      }, slowMs);
      timers.add(timer);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? DEFAULT_STUB_PORT, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests: () => structuredClone(recorded),
    clear: () => {
      recorded.length = 0;
      queued.length = 0;
    },
    answerNext: (text) => {
      queued.push(text);
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function error(type: string) {
  return { type: 'error', error: { type, message: `Claude test stub: ${type}.` } };
}

function parse(raw: string): unknown {
  try {
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

function redact(headers: http.IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[name] = SECRET_HEADERS.has(name) ? '<present>' : String(value);
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.CLAUDE_STUB_PORT ?? DEFAULT_STUB_PORT);
  const stub = await startClaudeStub({ port });
  console.log(`Claude test stub on ${stub.url}`);
  const stop = () => void stub.close().then(() => process.exit(0));
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
