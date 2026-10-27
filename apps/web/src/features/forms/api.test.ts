import { describe, expect, it } from 'vitest';
import { ApiError, type HttpMethod, type RequestJson } from '../databases/api';
import { createFormsClient, DEFAULT_CONFIRMATION, loadFillForm, parseFillForm } from './api';
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
  it('asks for the form behind a link, signed in or on the public route', async () => {
    const { request, calls } = fakeRequest(fillForm());
    const client = createFormsClient(request);
    const data = await client.getForm('ab/c');
    await client.getPublicForm('code-123');
    expect(data.form.title).toBe('QA dispute request');
    expect(calls.map((c) => [c.method, c.path])).toEqual([
      ['GET', '/api/forms/ab%2Fc'],
      ['GET', '/api/forms/public/code-123'],
    ]);
  });

  it('sends { answers } to the route the form was opened with', async () => {
    const { request, calls } = fakeRequest({ ok: true });
    const client = createFormsClient(request);
    await client.submitResponse('code-123', { 'prop-name': 'Avery Lin' }, 'member');
    await client.submitResponse('code-123', { 'prop-name': 'Avery Lin' }, 'public');
    expect(calls).toEqual([
      {
        method: 'POST',
        path: '/api/forms/code-123/responses',
        body: { answers: { 'prop-name': 'Avery Lin' } },
      },
      {
        method: 'POST',
        path: '/api/forms/public/code-123/responses',
        body: { answers: { 'prop-name': 'Avery Lin' } },
      },
    ]);
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
      access: 'member',
    });
    expect(client.getPublicForm).not.toHaveBeenCalled();
  });

  it('opens a form anyone can fill in when nobody is signed in', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(unauthorized());
    client.getPublicForm.mockResolvedValue(fillForm({ audience: 'anyone' }, { respondent: null }));
    await expect(loadFillForm(client, 'code-123')).resolves.toMatchObject({
      kind: 'form',
      access: 'public',
    });
  });

  it('asks to sign in when the link is not a form anyone can fill in', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(unauthorized());
    await expect(loadFillForm(client, 'code-123')).resolves.toEqual({ kind: 'sign_in' });
  });

  it('passes other failures on', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(new ApiError(404, 'not_found', NOT_FOUND));
    await expect(loadFillForm(client, 'code-123')).rejects.toThrow(NOT_FOUND);
    expect(client.getPublicForm).not.toHaveBeenCalled();
  });
});
