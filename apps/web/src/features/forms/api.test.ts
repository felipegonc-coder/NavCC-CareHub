import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type HttpMethod, type RequestJson } from '../databases/api';
import {
  createFormsClient,
  DEFAULT_CONFIRMATION,
  loadFillForm,
  parseFillForm,
  publicCoverUrl,
} from './api';
import { fillForm, mockFormsClient, NOT_FOUND } from './test-utils';

function fakeRequest(answer: unknown) {
  const calls: Array<{ method: HttpMethod; path: string; body: unknown }> = [];
  const request: RequestJson = <T>(method: HttpMethod, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    return Promise.resolve(answer as T);
  };
  return { request, calls };
}

const unauthorized = () => new ApiError(401, 'unauthorized', 'Sign in to continue.');

describe('createFormsClient', () => {
  it('asks for the form behind a link', async () => {
    const { request, calls } = fakeRequest(fillForm());
    const client = createFormsClient(request);
    const data = await client.getForm('ab/c');
    expect(data.form.title).toBe('QA dispute request');
    expect(calls.map((c) => [c.method, c.path])).toEqual([['GET', '/api/forms/ab%2Fc']]);
  });

  it('sends the answers as { answers, anonymous }', async () => {
    const { request, calls } = fakeRequest({ ok: true });
    const client = createFormsClient(request);
    await client.submitResponse('code-123', {
      answers: { 'prop-name': 'Avery Lin' },
      anonymous: false,
    });
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/forms/code-123/responses',
        body: { answers: { 'prop-name': 'Avery Lin' }, anonymous: false },
      },
    ]);
  });

  it('uses the public route for a form anyone can fill in', async () => {
    const { request, calls } = fakeRequest(fillForm({ audience: 'anyone' }, { respondent: null }));
    const client = createFormsClient(request);
    const data = await client.getPublicForm('ab/c');
    expect(data.form.audience).toBe('anyone');
    await client.submitPublicResponse('code-123', {
      answers: { 'prop-name': 'Avery Lin' },
      anonymous: true,
    });
    expect(calls).toEqual([
      { method: 'GET', path: '/api/forms/public/ab%2Fc', body: undefined },
      {
        method: 'POST',
        path: '/api/forms/public/code-123/responses',
        body: { answers: { 'prop-name': 'Avery Lin' }, anonymous: true },
      },
    ]);
    expect(publicCoverUrl('ab/c')).toBe('/api/forms/public/ab%2Fc/cover');
  });

  it('searches people and rows for the pickers', async () => {
    const { request, calls } = fakeRequest([]);
    const client = createFormsClient(request);
    await client.searchPeople('Avery Lin');
    await client.pickRows('db-jobs', 'leak');
    expect(calls.map((c) => c.path)).toEqual([
      '/api/workspace/members?q=Avery%20Lin',
      '/api/databases/db-jobs/rows/pick?q=leak',
    ]);
  });
});

describe('the default client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.cookie = 'carehub_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('sends a response through lib/api, with the CSRF header', async () => {
    document.cookie = 'carehub_csrf=token-1; path=/';
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createFormsClient().submitResponse('code-123', { answers: {}, anonymous: true }),
    ).resolves.toEqual({ ok: true });
    const [path, init = {}] = fetchMock.mock.calls.at(-1) ?? [];
    expect(path).toBe('/api/forms/code-123/responses');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('X-CSRF-Token')).toBe('token-1');
    expect(JSON.parse(String(init.body))).toEqual({ answers: {}, anonymous: true });
  });
});

describe('parseFillForm', () => {
  it('fills in what a trimmed answer leaves out', () => {
    const data = parseFillForm({
      formId: 'form-1',
      databaseId: 'db-requests',
      form: { title: 'QA dispute request', questions: [] },
      properties: [],
    });
    expect(data.form).toMatchObject({
      title: 'QA dispute request',
      description: [],
      submitLabel: 'Submit',
      confirmation: DEFAULT_CONFIRMATION,
      allowMultiple: false,
      accepting: true,
      anonymous: false,
      notifyUserIds: [],
    });
    expect(data.gate).toEqual({ state: 'open', message: null });
    expect(data.respondent).toBeNull();
  });

  it('keeps the gate message and the respondent', () => {
    const data = parseFillForm({
      ...fillForm(),
      gate: { state: 'closed', message: 'This form closed on Oct 30, 2026.' },
    });
    expect(data.gate).toEqual({ state: 'closed', message: 'This form closed on Oct 30, 2026.' });
    expect(data.respondent).toEqual({ userId: 'user-avery', timeZone: 'America/Denver' });
  });

  it('refuses an answer that is not a form', () => {
    expect(() => parseFillForm({ formId: 'form-1' })).toThrow(ApiError);
    expect(() => parseFillForm(null)).toThrow(ApiError);
  });
});

describe('loadFillForm', () => {
  it('opens the form for the person signed in', async () => {
    const client = mockFormsClient();
    await expect(loadFillForm(client, 'code-123')).resolves.toMatchObject({
      kind: 'form',
      signedOut: false,
    });
    expect(client.getForm).toHaveBeenCalledWith('code-123');
    expect(client.getPublicForm).not.toHaveBeenCalled();
  });

  it('asks to sign in when nobody is signed in', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(unauthorized());
    await expect(loadFillForm(client, 'code-123')).resolves.toEqual({ kind: 'sign_in' });
    expect(client.getPublicForm).toHaveBeenCalledWith('code-123');
  });

  it('opens a form anyone can fill in with nobody signed in', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(unauthorized());
    client.getPublicForm.mockResolvedValue(fillForm({ audience: 'anyone' }, { respondent: null }));
    await expect(loadFillForm(client, 'code-123')).resolves.toMatchObject({
      kind: 'form',
      signedOut: true,
    });
  });

  it('asks to sign in when the public route says so', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(unauthorized());
    client.getPublicForm.mockResolvedValueOnce(
      fillForm({}, { gate: { state: 'sign_in', message: null }, respondent: null }),
    );
    await expect(loadFillForm(client, 'code-123')).resolves.toEqual({ kind: 'sign_in' });
    client.getPublicForm.mockRejectedValueOnce(new ApiError(403, 'forbidden', 'Sign in first.'));
    await expect(loadFillForm(client, 'code-123')).resolves.toEqual({ kind: 'sign_in' });
  });

  it('asks to sign in when the form says so', async () => {
    const client = mockFormsClient(fillForm({}, { gate: { state: 'sign_in', message: null } }));
    await expect(loadFillForm(client, 'code-123')).resolves.toEqual({ kind: 'sign_in' });
  });

  it('passes other failures on', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValueOnce(new ApiError(404, 'not_found', NOT_FOUND));
    await expect(loadFillForm(client, 'code-123')).rejects.toThrow(NOT_FOUND);
    client.getForm.mockRejectedValueOnce(unauthorized());
    client.getPublicForm.mockRejectedValueOnce(new ApiError(0, 'offline', 'Offline.'));
    await expect(loadFillForm(client, 'code-123')).rejects.toThrow('Offline.');
  });
});
