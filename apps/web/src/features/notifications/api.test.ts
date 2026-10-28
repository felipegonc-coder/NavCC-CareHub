import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { notificationsClient } from './api';

const fetchMock = vi.fn<typeof fetch>();

function answer(status: number, body?: unknown): Response {
  if (body === undefined) return new Response(null, { status });
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function lastCall() {
  const [path, init] = fetchMock.mock.calls.at(-1) ?? [];
  return { path, method: init?.method, body: init?.body };
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('notificationsClient', () => {
  it('reads and saves the notification settings', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, { preferences: { notifyAbout: 'all', showText: true, pause: null } }),
    );
    await expect(notificationsClient.getPreferences()).resolves.toEqual({
      notifyAbout: 'all',
      showText: true,
      pause: null,
    });
    expect(lastCall()).toMatchObject({ path: '/api/push/preferences', method: 'GET' });

    fetchMock.mockResolvedValueOnce(
      answer(200, { preferences: { notifyAbout: 'mentions', showText: true, pause: null } }),
    );
    await expect(
      notificationsClient.updatePreferences({ notifyAbout: 'mentions' }),
    ).resolves.toEqual({ notifyAbout: 'mentions', showText: true, pause: null });
    expect(lastCall()).toEqual({
      path: '/api/push/preferences',
      method: 'PATCH',
      body: JSON.stringify({ notifyAbout: 'mentions' }),
    });
  });

  it('reads settings with no pause as not paused', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(200, { preferences: { notifyAbout: 'nothing', showText: false } }),
    );
    await expect(notificationsClient.getPreferences()).resolves.toEqual({
      notifyAbout: 'nothing',
      showText: false,
      pause: null,
    });
  });

  it('pauses notifications and turns them back on', async () => {
    const until = '2026-10-28T14:00:00.000Z';
    fetchMock.mockResolvedValueOnce(
      answer(200, { preferences: { notifyAbout: 'all', showText: true, pause: { until } } }),
    );
    await expect(notificationsClient.pause('tomorrow_8am')).resolves.toMatchObject({
      pause: { until },
    });
    expect(lastCall()).toEqual({
      path: '/api/push/pause',
      method: 'PUT',
      body: JSON.stringify({ ends: 'tomorrow_8am' }),
    });

    fetchMock.mockResolvedValueOnce(
      answer(200, { preferences: { notifyAbout: 'all', showText: true, pause: null } }),
    );
    await expect(notificationsClient.resume()).resolves.toMatchObject({ pause: null });
    expect(lastCall()).toEqual({ path: '/api/push/pause', method: 'DELETE', body: undefined });
  });

  it('lists and removes browsers', async () => {
    const device = {
      id: 'sub 1',
      device: 'Firefox on Linux',
      createdAt: '2026-10-20T12:00:00.000Z',
      lastUsedAt: '2026-10-27T12:00:00.000Z',
    };
    fetchMock.mockResolvedValueOnce(answer(200, { subscriptions: [device] }));
    await expect(notificationsClient.listDevices()).resolves.toEqual([device]);
    expect(lastCall()).toMatchObject({ path: '/api/push/subscriptions', method: 'GET' });

    fetchMock.mockResolvedValueOnce(answer(204));
    await expect(notificationsClient.removeDevice('sub 1')).resolves.toBeUndefined();
    expect(lastCall()).toMatchObject({ path: '/api/push/subscriptions/sub%201', method: 'DELETE' });
  });

  it('sends a test notification and says whether push is set up', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { sent: 2, removed: 1, failed: 0 }));
    await expect(notificationsClient.sendTest()).resolves.toEqual({
      sent: 2,
      removed: 1,
      failed: 0,
    });
    expect(lastCall()).toEqual({ path: '/api/push/test', method: 'POST', body: undefined });

    fetchMock.mockResolvedValueOnce(answer(200, { publicKey: 'BKey' }));
    await expect(notificationsClient.pushIsSetUp()).resolves.toBe(true);
    fetchMock.mockResolvedValueOnce(answer(200, { publicKey: null }));
    await expect(notificationsClient.pushIsSetUp()).resolves.toBe(false);
    expect(lastCall()).toMatchObject({ path: '/api/push/key', method: 'GET' });
  });

  it('refuses an answer of the wrong shape', async () => {
    fetchMock.mockResolvedValueOnce(answer(200, { preferences: { notifyAbout: 'often' } }));
    const error = await notificationsClient.getPreferences().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'invalid_response' });
  });
});
