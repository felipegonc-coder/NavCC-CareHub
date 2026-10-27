import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { copyPictureFromUrl, heicAsJpeg, isHeic, uploadFile } from './files';

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Stands in for XMLHttpRequest: keeps what was sent, and answers when a test says so. */
class FakeRequest {
  static last: FakeRequest | undefined;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: FormData | undefined;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onloadend: (() => void) | null = null;

  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  send(body: FormData) {
    this.body = body;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
    this.onloadend?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
    this.onloadend?.();
  }
  fail() {
    this.onerror?.();
    this.onloadend?.();
  }
}

/** The request uploadFile made, once it has made it. */
async function sent(): Promise<FakeRequest> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (!FakeRequest.last) throw new Error('Nothing was sent.');
  return FakeRequest.last;
}

const sentFile = (request: FakeRequest) => request.body?.get('file') as File;
const notes = () => new File(['Fictional notes'], 'notes.txt', { type: 'text/plain' });
const uploaded = {
  id: '0b6f8a8e-9a43-4c1e-8f6e-2f7f4f1d6c11',
  name: 'notes.txt',
  size: 15,
  mimeType: 'text/plain',
  url: '/api/files/0b6f8a8e-9a43-4c1e-8f6e-2f7f4f1d6c11',
};

/** A browser that can read HEIC photos, as Safari can. */
function readsHeic() {
  const drawImage = vi.fn();
  const close = vi.fn();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 4, height: 3, close })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done: BlobCallback) =>
    done(new Blob(['fictional jpeg'], { type: 'image/jpeg' })),
  );
  return { drawImage, close };
}

beforeEach(() => {
  FakeRequest.last = undefined;
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = 'carehub_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
});

describe('uploadFile', () => {
  it('sends the file to its scope with the CSRF header, and reports progress', async () => {
    document.cookie = 'carehub_csrf=abc%2Fdef; path=/';
    const progress: Array<[number, number]> = [];
    const done = uploadFile(notes(), {
      scope: 'learning:course-1',
      onProgress: ({ loaded, total }) => progress.push([loaded, total]),
    });
    const request = await sent();
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/files?scope=learning%3Acourse-1');
    expect(request.headers['x-csrf-token']).toBe('abc/def');
    expect(sentFile(request)).toMatchObject({ name: 'notes.txt', type: 'text/plain', size: 15 });

    request.progress(100, 400);
    request.progress(400, 400);
    request.respond(201, uploaded);
    await expect(done).resolves.toEqual(uploaded);
    expect(progress).toEqual([
      [100, 400],
      [400, 400],
    ]);
  });

  it('sends files for forms anyone can fill in to the anonymous route', async () => {
    const done = uploadFile(notes(), { scope: 'forms:form-1', anonymous: true });
    const request = await sent();
    expect(request.url).toBe('/api/files/anonymous?scope=forms%3Aform-1');
    expect(sentFile(request)).toMatchObject({ name: 'notes.txt', size: 15 });
    request.respond(201, uploaded);
    await expect(done).resolves.toEqual(uploaded);
  });

  it("rejects with Care Hub's error, or one for the status", async () => {
    const tooLarge = uploadFile(notes(), { scope: 'learning:course-1' });
    (await sent()).respond(413, {
      error: { code: 'too_large', message: 'This file is 310 MB; the limit is 100 MB.' },
    });
    const error = await tooLarge.catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 413,
      code: 'too_large',
      message: 'This file is 310 MB; the limit is 100 MB.',
    });

    const forbidden = uploadFile(notes(), { scope: 'learning:course-1' });
    (await sent()).respond(403, '<html>Forbidden</html>');
    await expect(forbidden).rejects.toMatchObject({ status: 403, code: 'forbidden' });

    const odd = uploadFile(notes(), { scope: 'learning:course-1' });
    (await sent()).respond(201, { id: 1 });
    await expect(odd).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it("says so when Care Hub can't be reached", async () => {
    const done = uploadFile(notes(), { scope: 'learning:course-1' });
    (await sent()).fail();
    await expect(done).rejects.toMatchObject({ status: 0, code: 'offline' });
  });

  it('cancels with the signal, with an AbortError', async () => {
    const controller = new AbortController();
    const done = uploadFile(notes(), { scope: 'learning:course-1', signal: controller.signal });
    const request = await sent();
    controller.abort();
    expect(request.aborted).toBe(true);
    await expect(done).rejects.toMatchObject({ name: 'AbortError' });

    FakeRequest.last = undefined;
    const early = new AbortController();
    early.abort(new Error('Some other reason'));
    await expect(
      uploadFile(notes(), { scope: 'learning:course-1', signal: early.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeRequest.last).toBeUndefined();
  });

  it('sends HEIC photos as JPEG when the browser can read them', async () => {
    const { drawImage, close } = readsHeic();
    const photo = new File(['fictional heic'], 'IMG_0001.HEIC', { type: 'image/heic' });
    const done = uploadFile(photo, { scope: 'learning:course-1' });
    const request = await sent();
    expect(sentFile(request)).toMatchObject({ name: 'IMG_0001.jpg', type: 'image/jpeg' });
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    request.respond(201, { ...uploaded, name: 'IMG_0001.jpg', mimeType: 'image/jpeg' });
    await expect(done).resolves.toMatchObject({ name: 'IMG_0001.jpg' });
  });
});

describe('copyPictureFromUrl', () => {
  it('asks Care Hub to copy the picture into the scope', async () => {
    const copied = {
      id: '0b0c7f39-5d9e-4c55-9e57-3f4f3a1e2d10',
      name: 'Harbour at dusk.png',
      size: 2048,
      mimeType: 'image/png',
      url: '/api/files/0b0c7f39-5d9e-4c55-9e57-3f4f3a1e2d10',
    };
    const sent: Array<{ path: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, init?: RequestInit) => {
        sent.push({ path, init });
        return json(copied, 201);
      }),
    );
    document.cookie = 'carehub_csrf=fictional-token; path=/';

    const url = 'https://pictures.example/harbour.png';
    expect(await copyPictureFromUrl(url, { scope: 'learning:course-1' })).toEqual(copied);
    expect(sent).toHaveLength(1);
    const [{ path, init } = { path: '' }] = sent;
    expect(path).toBe('/api/files/from-url');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ url, scope: 'learning:course-1' });
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('fictional-token');
  });

  it("rejects with Care Hub's reason, so the link can stay a link", async () => {
    const message = 'Care Hub copies pictures only from public websites.';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: { code: 'invalid', message } }, 400)),
    );
    const failed = copyPictureFromUrl('http://10.0.0.8/a.png', { scope: 'pages:page-1' });
    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({ status: 400, code: 'invalid', message });
  });
});

describe('heicAsJpeg', () => {
  it("keeps the photo as it is where the browser can't read HEIC", async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('Unsupported', 'InvalidStateError');
      }),
    );
    const photo = new File(['fictional heic'], 'IMG_0002.heic', { type: 'image/heic' });
    expect(await heicAsJpeg(photo)).toBe(photo);
  });

  it('finds HEIC photos by type, or by ending when the browser gives no type', () => {
    expect(isHeic(new File([''], 'a.heic', { type: 'image/heic' }))).toBe(true);
    expect(isHeic(new File([''], 'b.HEIF', { type: '' }))).toBe(true);
    expect(isHeic(new File([''], 'c.heic', { type: 'image/jpeg' }))).toBe(false);
    expect(isHeic(new File([''], 'd.jpg', { type: 'image/jpeg' }))).toBe(false);
  });
});
