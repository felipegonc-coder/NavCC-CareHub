// Test helpers for the media folder (imported by tests only).

/** Stands in for XMLHttpRequest: records what an upload asks of the browser and answers when the test says. */
export class FakeRequest {
  static last: FakeRequest | undefined;
  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown;
  status = 0;
  responseText = '';
  aborted = false;
  upload: { onprogress: ((event: Partial<ProgressEvent>) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

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
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }
  answer(status: number, body: unknown) {
    this.status = status;
    this.responseText = typeof body === 'string' ? body : JSON.stringify(body);
    this.onload?.();
  }
}

const realRequest = globalThis.XMLHttpRequest;

/** Puts FakeRequest in place of XMLHttpRequest; returns a function that puts the real one back. */
export function fakeRequests(): () => void {
  FakeRequest.last = undefined;
  globalThis.XMLHttpRequest = FakeRequest as unknown as typeof XMLHttpRequest;
  return () => {
    globalThis.XMLHttpRequest = realRequest;
  };
}

/** The hidden file input of a MediaPicker. */
export function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('No file input.');
  return input;
}

/** The last request sent. */
export function sent(): FakeRequest {
  if (!FakeRequest.last) throw new Error('Nothing was sent.');
  return FakeRequest.last;
}

/** The file the last request sent (the multipart "file" field). */
export function sentFile(): File {
  const body = sent().body;
  const file = body instanceof FormData ? body.get('file') : null;
  if (!(file instanceof File)) throw new Error('No file was sent.');
  return file;
}

const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];

/** A tiny PNG file of `width` × `height` pixels (just enough for the upload checks). */
export function pngFile(name: string, width: number, height: number): File {
  const ascii = (text: string) => Array.from(text, (c) => c.charCodeAt(0));
  const bytes = Uint8Array.from([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...be32(13),
    ...ascii('IHDR'),
    ...be32(width),
    ...be32(height),
    ...[8, 6, 0, 0, 0],
    ...be32(0),
  ]);
  return new File([bytes], name, { type: 'image/png' });
}

/** Gives a picture the sizes a browser would (jsdom has no layout) and fires its load event. */
export function loadPicture(
  picture: HTMLImageElement,
  shown: { width: number; height: number },
  natural: { width: number; height: number },
) {
  const sizes = {
    clientWidth: shown.width,
    clientHeight: shown.height,
    naturalWidth: natural.width,
    naturalHeight: natural.height,
  };
  for (const [key, value] of Object.entries(sizes))
    Object.defineProperty(picture, key, { configurable: true, value });
  picture.dispatchEvent(new Event('load'));
}

/**
 * Stands in for the canvas (jsdom has none): records what is drawn, and `toBlob` gives a small PNG of the
 * canvas size, as a browser that can't make WebP would. Returns the drawings and a function that puts the
 * real canvas back.
 */
export function fakeCanvas(): { drawn: unknown[][]; restore: () => void } {
  const proto = HTMLCanvasElement.prototype;
  const { getContext, toBlob } = proto;
  const drawn: unknown[][] = [];
  const context = {
    imageSmoothingQuality: 'low',
    globalCompositeOperation: 'source-over',
    fillStyle: '',
    drawImage: (...args: unknown[]) => drawn.push(args),
    fillRect: () => {},
  };
  proto.getContext = (() => context) as unknown as typeof proto.getContext;
  proto.toBlob = function (this: HTMLCanvasElement, callback: BlobCallback) {
    callback(pngFile('canvas.png', this.width, this.height));
  };
  return {
    drawn,
    restore: () => {
      proto.getContext = getContext;
      proto.toBlob = toBlob;
    },
  };
}

/** A request made through `fetch`, and a way to answer it. */
export type FakeCall = {
  url: string;
  init: RequestInit | undefined;
  answer(status: number, body: unknown): void;
};

/**
 * Stands in for `fetch`: records each call and answers when the test says (an aborted call fails with an
 * `AbortError`, as in a browser). Returns the calls and a function that puts the real `fetch` back.
 */
export function fakeFetch(): { calls: FakeCall[]; restore: () => void } {
  const real = globalThis.fetch;
  const calls: FakeCall[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The request was stopped.', 'AbortError')),
      );
      calls.push({
        url: String(input),
        init,
        answer: (status, body) => {
          const text = typeof body === 'string' ? body : JSON.stringify(body);
          resolve({
            status,
            ok: status >= 200 && status < 300,
            text: async () => text,
          } as Response);
        },
      });
    })) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = real;
    },
  };
}
