import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formUploadScope, uploadWithProgress, type UploadedFile } from './uploads';

/** Stands in for XMLHttpRequest: keeps what was sent, and answers when a test says so. */
class FakeRequest {
  static last: FakeRequest | null = null;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  status = 0;
  responseText = '';
  upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeRequest.last = this;
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

function sent(): FakeRequest {
  if (!FakeRequest.last) throw new Error('Nothing was sent.');
  return FakeRequest.last;
}

const photo = () => new File(['leak'], 'sink.heic', { type: 'image/heic' });
const SAVED: UploadedFile = {
  id: 'file-1',
  name: 'sink.heic',
  size: 4,
  mimeType: 'image/heic',
  url: '/api/files/file-1',
};

beforeEach(() => {
  FakeRequest.last = null;
  vi.stubGlobal('XMLHttpRequest', FakeRequest);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'carehub_csrf=; max-age=0; path=/';
});

describe('uploadWithProgress', () => {
  it('posts the file to the files API with the CSRF token from the cookie', async () => {
    document.cookie = 'carehub_csrf=csrf-token-1; path=/';
    const done = uploadWithProgress(photo(), { scope: formUploadScope('form-1') });
    const request = sent();
    expect(request.method).toBe('POST');
    expect(request.url).toBe('/api/files?scope=forms%3Aform-1');
    expect(request.headers['X-CSRF-Token']).toBe('csrf-token-1');
    expect(request.body instanceof FormData).toBe(true);
    request.answer(201, SAVED);
    await expect(done).resolves.toEqual(SAVED);
  });

  it('sends the token from the HTTPS cookie when there is one', () => {
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => 'theme=dark; __Host-carehub_csrf=csrf-secure-1; carehub_csrf=csrf-plain-1',
    });
    try {
      void uploadWithProgress(photo(), { scope: 'forms:form-1' });
      expect(sent().headers['X-CSRF-Token']).toBe('csrf-secure-1');
    } finally {
      Reflect.deleteProperty(document, 'cookie');
    }
  });

  it('sends no CSRF header when there is no cookie', () => {
    void uploadWithProgress(photo(), { scope: 'forms:form-1' });
    expect(sent().headers['X-CSRF-Token']).toBeUndefined();
  });

  it("sends the form's fill token as X-Form-Fill, and none without one", () => {
    void uploadWithProgress(photo(), { scope: 'forms:form-1', fill: 'fill-1' });
    expect(sent().headers['X-Form-Fill']).toBe('fill-1');
    void uploadWithProgress(photo(), { scope: 'forms:form-1' });
    expect(sent().headers['X-Form-Fill']).toBeUndefined();
  });

  it("rejects with the server's message", async () => {
    const done = uploadWithProgress(photo(), { scope: 'forms:form-1' });
    sent().answer(415, { error: { code: 'file_type', message: "This file type isn't allowed." } });
    await expect(done).rejects.toMatchObject({
      status: 415,
      code: 'file_type',
      message: "This file type isn't allowed.",
    });
  });
});
