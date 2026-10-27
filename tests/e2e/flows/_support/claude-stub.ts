// The Claude stub's log and answers (docs/extras/testing.md#claude). Tests never reach Claude: the
// e2e server sends Claude requests to a stub that runs as its own process for the whole run, at
// http://127.0.0.1:<CLAUDE_STUB_PORT> (4599 by default). Tests never start it; they read and clear
// its log, and pick its next answer, over HTTP. The log shows the key header as "<present>".

/** One request the stub received. */
export type StubRequest = {
  time: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

/** The fictional key the e2e server runs with. Never a real key. */
export const TEST_KEY = process.env.ANTHROPIC_API_KEY ?? 'test-key-not-real';

/** Words that make the stub answer 429 or 500, or only after 35 seconds. */
export const words = { tooMany: 'STUB-429', broken: 'STUB-500', slow: 'STUB-SLOW' } as const;

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  const port = process.env.CLAUDE_STUB_PORT ?? '4599';
  const json = body === undefined ? {} : { body: JSON.stringify(body) };
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...json,
  });
  if (!response.ok) throw new Error(`The Claude stub answered ${response.status} to ${method}`);
  return response;
}

/** Every request the stub received since it was last cleared, oldest first. */
export async function requests(): Promise<StubRequest[]> {
  return (await (await call('GET', '/__requests')).json()) as StubRequest[];
}

/** Forgets every request so far, so a check sees only its own. */
export async function clear(): Promise<void> {
  await call('DELETE', '/__requests');
}

/** The text of the stub's next answer, used once. Answers picked this way queue up in order. */
export async function answerNext(text: string): Promise<void> {
  await call('POST', '/__answers', { text });
}

/** What was sent to the stub since it was cleared, as one string to look for words in. */
export async function sentText(): Promise<string> {
  return JSON.stringify((await requests()).map((request) => request.body));
}
