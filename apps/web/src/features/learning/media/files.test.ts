import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UploadError, uploadFile, uploadFromUrl, type UploadedFile } from './files';
import { FakeRequest, fakeFetch, fakeRequests, sent } from './testing';

const failure = (upload: Promise<unknown>) =>
  upload.then(
    () => {
      throw new Error('The upload should have failed.');
    },
    (error: unknown) => error,
  );
const fields = (error: unknown) => {
  if (!(error instanceof UploadError)) throw new Error(`Not an UploadError: ${String(error)}`);
  return { status: error.status, code: error.code, message: error.message };
};

const picture = () => new File([new Uint8Array(100)], 'Ward map.png', { type: 'image/png' });
const answer: UploadedFile = {
  id: '0b6f8a8e-9a43-4c1e-8f6e-2f7f4f1d6c11',
  name: 'Ward map.png',
  size: 100,
  mimeType: 'image/png',
  url: '/api/files/0b6f8a8e-9a43-4c1e-8f6e-2f7f4f1d6c11',
  width: 40,
  height: 30,
};
let restore = () => {};

beforeEach(() => {
  restore = fakeRequests();
  document.cookie = 'carehub_csrf=fictional-token';
});

afterEach(() => {
  restore();
  document.cookie = 'carehub_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('uploadFile', () => {
  it('sends the file as the "file" field with its scope and CSRF token, and reports progress', async () => {
    const file = picture();
    const progress: number[] = [];
    const upload = uploadFile(file, {
      scope: 'learning:course-1',
      onProgress: (fraction) => progress.push(fraction),
    });
    const request = sent();
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/files?scope=learning%3Acourse-1');
    expect(request.headers).toEqual({ 'X-CSRF-Token': 'fictional-token' }); // the browser sets the multipart type
    const sentFile = (request.body as FormData).get('file') as File;
    expect(sentFile.name).toBe('Ward map.png');
    expect(sentFile.size).toBe(100);
    request.progress(25, 100);
    request.answer(201, answer);
    expect(await upload).toEqual(answer);
    expect(progress).toEqual([0.25, 1]);
  });

  it("fails with the server's message", async () => {
    const upload = uploadFile(picture(), { scope: 'learning:course-1' });
    const message = 'This picture is 11 MB. Pictures can be at most 10 MB.';
    sent().answer(413, { error: { code: 'too_large', message } });
    expect(fields(await failure(upload))).toEqual({ status: 413, code: 'too_large', message });
  });

  it("fails plainly when the answer can't be read or the connection drops", async () => {
    const plain = "The file couldn't be uploaded. Try again.";
    const broken = uploadFile(picture(), { scope: 'learning:course-1' });
    sent().answer(502, '<html>Bad gateway</html>');
    expect(fields(await failure(broken))).toEqual({
      status: 502,
      code: 'server_error',
      message: plain,
    });
    const odd = uploadFile(picture(), { scope: 'learning:course-1' });
    sent().answer(201, { id: answer.id });
    expect(fields(await failure(odd))).toMatchObject({ status: 201, code: 'server_error' });
    const offline = uploadFile(picture(), { scope: 'learning:course-1' });
    sent().onerror?.();
    expect(fields(await failure(offline))).toEqual({
      status: 0,
      code: 'network',
      message: 'The upload stopped. Check your connection and try again.',
    });
  });

  it('stops when asked', async () => {
    const controller = new AbortController();
    const upload = uploadFile(picture(), { scope: 'learning:course-1', signal: controller.signal });
    controller.abort();
    expect(sent().aborted).toBe(true);
    expect(((await failure(upload)) as DOMException).name).toBe('AbortError');
    FakeRequest.last = undefined;
    const late = uploadFile(picture(), { scope: 'learning:course-1', signal: controller.signal });
    expect(((await failure(late)) as DOMException).name).toBe('AbortError');
    expect(FakeRequest.last).toBeUndefined();
  });

  it('sends no CSRF header without the cookie', () => {
    document.cookie = 'carehub_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    void uploadFile(picture(), { scope: 'learning:course-1' }).catch(() => undefined);
    expect(sent().headers['X-CSRF-Token']).toBeUndefined();
  });
});

describe('uploadFromUrl', () => {
  let fetches: ReturnType<typeof fakeFetch>;
  beforeEach(() => {
    fetches = fakeFetch();
  });
  afterEach(() => fetches.restore());

  it('asks the server to copy the picture into the scope', async () => {
    const copy = uploadFromUrl('https://example.org/map.png', { scope: 'learning:course-1' });
    const [call] = fetches.calls;
    expect(call?.url).toBe('/api/files/from-url');
    expect(call?.init?.method).toBe('POST');
    expect(call?.init?.headers).toEqual({
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'fictional-token',
    });
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      url: 'https://example.org/map.png',
      scope: 'learning:course-1',
    });
    call?.answer(201, answer);
    expect(await copy).toEqual(answer);
  });

  it("fails with the server's message, or plainly", async () => {
    const refused = uploadFromUrl('https://example.org/map.png', { scope: 'learning:course-1' });
    const message = "That link doesn't go to a picture.";
    fetches.calls[0]?.answer(400, { error: { code: 'invalid', message } });
    expect(fields(await failure(refused))).toEqual({ status: 400, code: 'invalid', message });
    const missing = uploadFromUrl('https://example.org/gone.png', { scope: 'learning:course-1' });
    fetches.calls[1]?.answer(404, { error: { code: 'not_found', message: 'Not here.' } });
    expect(fields(await failure(missing))).toEqual({
      status: 404,
      code: 'not_found',
      message: "The picture couldn't be copied from that link. Download it, then upload it.",
    });
  });

  it('reads the CSRF cookie by its HTTPS name too', () => {
    // jsdom can't set a __Host- cookie (it needs HTTPS), so the cookie text is given directly.
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'theme=dark; __Host-carehub_csrf=secure-token',
    });
    try {
      void uploadFromUrl('https://example.org/map.png', { scope: 'learning:course-1' });
      expect(fetches.calls[0]?.init?.headers).toMatchObject({ 'X-CSRF-Token': 'secure-token' });
    } finally {
      delete (document as { cookie?: string }).cookie; // back to the real cookie
    }
  });
});
