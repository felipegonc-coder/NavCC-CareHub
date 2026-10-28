import { ToastProvider } from '@carehub/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import type { NotificationPreferences, NotificationsClient, PauseEnds, PushDevice } from './api';
import { NotificationSettings } from './NotificationSettings';
import { PUSH_PROBLEM_TEXT, type PushResult, type PushStatus } from './push-client';
import type { BrowserPush } from './useBrowserPush';

// jsdom lacks what Radix's select list measures and scrolls with.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

beforeAll(() => {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= () => undefined;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
});

const LAPTOP: PushDevice = {
  id: 'sub-1',
  device: 'Firefox on Linux',
  createdAt: '2026-10-20T12:00:00.000Z',
  lastUsedAt: '2026-10-27T12:00:00.000Z',
};
const PHONE: PushDevice = {
  id: 'sub-2',
  device: 'Safari on iPhone',
  createdAt: '2026-10-21T12:00:00.000Z',
  lastUsedAt: '2026-10-26T12:00:00.000Z',
};
const THIS_BROWSER: PushDevice = {
  id: 'sub-3',
  device: 'Chrome on Windows',
  createdAt: '2026-10-27T12:00:00.000Z',
  lastUsedAt: '2026-10-27T12:00:00.000Z',
};

interface Options {
  pause?: NotificationPreferences['pause'];
  devices?: PushDevice[];
  status?: PushStatus;
  serverReady?: boolean;
  turnOn?: PushResult;
}

/** A server and a browser that remember changes, like the real ones. */
function fakes({
  pause = null,
  devices = [LAPTOP, PHONE],
  status = 'off',
  serverReady = true,
  turnOn,
}: Options = {}) {
  let saved: NotificationPreferences = { notifyAbout: 'all', showText: true, pause };
  let list = [...devices];
  let browser = status;
  const client = {
    // A pause that has ended reads as none, as on the server.
    getPreferences: vi.fn(async () => {
      const until = saved.pause?.until;
      if (until && Date.parse(until) <= Date.now()) saved = { ...saved, pause: null };
      return saved;
    }),
    updatePreferences: vi.fn(async (changes: Partial<NotificationPreferences>) => {
      saved = { ...saved, ...changes };
      return saved;
    }),
    pause: vi.fn(async (ends: PauseEnds) => {
      const until = ends === 'in_an_hour' ? new Date(Date.now() + 3_600_000).toISOString() : null;
      saved = { ...saved, pause: { until } };
      return saved;
    }),
    resume: vi.fn(async () => {
      saved = { ...saved, pause: null };
      return saved;
    }),
    listDevices: vi.fn(async () => list),
    removeDevice: vi.fn(async (id: string) => {
      list = list.filter((device) => device.id !== id);
    }),
    sendTest: vi.fn(async () => ({ sent: list.length, removed: 0, failed: 0 })),
    pushIsSetUp: vi.fn(async () => serverReady),
  } satisfies NotificationsClient;
  const push = {
    status: vi.fn(async () => browser),
    turnOn: vi.fn(async (): Promise<PushResult> => {
      if (turnOn) return turnOn;
      browser = 'on';
      list = [...list, THIS_BROWSER];
      return { ok: true };
    }),
    turnOff: vi.fn(async () => {
      browser = 'off';
      list = list.filter((device) => device.id !== THIS_BROWSER.id);
    }),
  } satisfies BrowserPush;
  return { client, push };
}

function show({ client, push }: ReturnType<typeof fakes>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <NotificationSettings client={client} push={push} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const section = (name: string) => screen.getByRole('region', { name });

describe('NotificationSettings: Messages', () => {
  it('shows the saved settings and saves a new choice, with "Saved" for 2 seconds', async () => {
    const parts = fakes();
    show(parts);
    const select = await screen.findByRole('combobox', { name: 'Notify me about' });
    expect(select).toHaveTextContent('All messages');
    expect(
      screen.getByRole('switch', { name: 'Show message text in notifications' }),
    ).toBeChecked();

    fireEvent.keyDown(select, { key: 'Enter' });
    fireEvent.click(
      await screen.findByRole('option', { name: 'Only direct messages, @mentions and notices' }),
    );
    await waitFor(() =>
      expect(parts.client.updatePreferences).toHaveBeenCalledWith({ notifyAbout: 'mentions' }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Notify me about' })).toHaveTextContent(
      'Only direct messages, @mentions and notices',
    );
    await waitFor(() => expect(screen.queryByText('Saved')).not.toBeInTheDocument(), {
      timeout: 3_000,
    });
  });

  it('turns message text off', async () => {
    const parts = fakes();
    show(parts);
    const toggle = await screen.findByRole('switch', {
      name: 'Show message text in notifications',
    });
    expect(toggle).toHaveAccessibleDescription(/only who and what kind/);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(parts.client.updatePreferences).toHaveBeenCalledWith({ showText: false }),
    );
    expect(toggle).not.toBeChecked();
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it("puts a setting back and names it when it can't be saved", async () => {
    const parts = fakes();
    parts.client.updatePreferences.mockRejectedValueOnce(
      new ApiError(0, 'offline', "Can't reach Care Hub. Check your connection, then try again."),
    );
    show(parts);
    const toggle = await screen.findByRole('switch', {
      name: 'Show message text in notifications',
    });
    fireEvent.click(toggle);
    expect(
      await screen.findByText('Couldn\'t save "Show message text in notifications". Try again.'),
    ).toBeInTheDocument();
    expect(toggle).toBeChecked();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it("offers Retry when the settings can't be loaded", async () => {
    const parts = fakes();
    parts.client.getPreferences.mockRejectedValueOnce(new Error('offline'));
    show(parts);
    expect(
      await screen.findByText("Couldn't load your notification settings."),
    ).toBeInTheDocument();
    fireEvent.click(within(section('Messages')).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('combobox', { name: 'Notify me about' })).toBeInTheDocument();
  });
});

describe('NotificationSettings: pause', () => {
  it('pauses for an hour, then turns notifications back on', async () => {
    const parts = fakes();
    show(parts);
    const pause = await screen.findByRole('region', { name: 'Pause notifications' });
    expect(
      within(pause).getByText('Notices still arrive in the 🔔 chat, quietly.'),
    ).toBeInTheDocument();
    fireEvent.keyDown(within(pause).getByRole('button', { name: 'Pause' }), { key: 'Enter' });
    expect(
      await screen.findByRole('menuitem', { name: 'Until tomorrow, 8:00 AM' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Until I turn them back on' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'For 1 hour' }));
    await waitFor(() => expect(parts.client.pause).toHaveBeenCalledWith('in_an_hour'));
    const turnBackOn = await within(pause).findByRole('button', { name: 'Turn back on' });
    expect(turnBackOn).toHaveAccessibleDescription(
      /^Paused until (tomorrow, )?\d{1,2}:\d{2} [AP]M\.$/,
    );
    await waitFor(() => expect(turnBackOn).toHaveFocus());

    fireEvent.click(turnBackOn);
    const again = await within(pause).findByRole('button', { name: 'Pause' });
    await waitFor(() => expect(again).toHaveFocus());
    expect(parts.client.resume).toHaveBeenCalledTimes(1);
    expect(within(pause).queryByText(/^Paused until/)).not.toBeInTheDocument();
  });

  it('shows a pause that lasts until turned back on', async () => {
    show(fakes({ pause: { until: null } }));
    const pause = await screen.findByRole('region', { name: 'Pause notifications' });
    expect(within(pause).getByText('Paused until you turn them back on.')).toBeInTheDocument();
    expect(within(pause).getByRole('button', { name: 'Turn back on' })).toBeInTheDocument();
  });

  it('shows notifications are back on once the pause ends', async () => {
    const until = new Date(Date.now() + 1_000).toISOString();
    const parts = fakes({ pause: { until } });
    show(parts);
    const pause = await screen.findByRole('region', { name: 'Pause notifications' });
    expect(within(pause).getByRole('button', { name: 'Turn back on' })).toBeInTheDocument();
    expect(
      await within(pause).findByRole('button', { name: 'Pause' }, { timeout: 4_000 }),
    ).toBeInTheDocument();
    expect(parts.client.resume).not.toHaveBeenCalled();
  });

  it("says so when it can't pause", async () => {
    const parts = fakes();
    parts.client.pause.mockRejectedValueOnce(new Error('offline'));
    show(parts);
    const pause = await screen.findByRole('region', { name: 'Pause notifications' });
    fireEvent.keyDown(within(pause).getByRole('button', { name: 'Pause' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Until I turn them back on' }));
    expect(
      await within(pause).findByText("Couldn't pause notifications. Try again."),
    ).toBeInTheDocument();
    expect(within(pause).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it("says so when it can't turn notifications back on", async () => {
    const parts = fakes({ pause: { until: null } });
    parts.client.resume.mockRejectedValueOnce(new Error('offline'));
    show(parts);
    const pause = await screen.findByRole('region', { name: 'Pause notifications' });
    fireEvent.click(within(pause).getByRole('button', { name: 'Turn back on' }));
    expect(
      await within(pause).findByText("Couldn't turn notifications back on. Try again."),
    ).toBeInTheDocument();
    expect(within(pause).getByText('Paused until you turn them back on.')).toBeInTheDocument();
  });
});

describe('NotificationSettings: this browser', () => {
  it('turns push on, then off, and updates the list of browsers', async () => {
    const parts = fakes();
    show(parts);
    const browser = await screen.findByRole('region', { name: 'This browser' });
    expect(
      await within(browser).findByText(
        "Get notifications in this browser, also when Care Hub isn't open.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(within(browser).getByRole('button', { name: 'Turn on' }));
    expect(parts.push.turnOn).toHaveBeenCalledTimes(1);
    expect(
      await within(browser).findByText(
        "Notifications are on in this browser, also when Care Hub isn't open.",
      ),
    ).toBeInTheDocument();
    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();

    const turnOff = within(browser).getByRole('button', { name: 'Turn off' });
    await waitFor(() => expect(turnOff).not.toHaveAttribute('aria-busy'));
    fireEvent.click(turnOff);
    expect(await within(browser).findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Chrome on Windows')).not.toBeInTheDocument());
    expect(parts.push.turnOff).toHaveBeenCalledTimes(1);
  });

  it("says why turning on didn't work", async () => {
    show(fakes({ turnOn: { ok: false, problem: 'dismissed' } }));
    const browser = await screen.findByRole('region', { name: 'This browser' });
    fireEvent.click(await within(browser).findByRole('button', { name: 'Turn on' }));
    expect(await within(browser).findByText(PUSH_PROBLEM_TEXT.dismissed)).toBeInTheDocument();
    expect(within(browser).getByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it.each(['needs-home-screen', 'denied', 'unsupported', 'insecure'] as const)(
    'explains %s instead of offering Turn on',
    async (status) => {
      show(fakes({ status }));
      const browser = await screen.findByRole('region', { name: 'This browser' });
      expect(await within(browser).findByText(PUSH_PROBLEM_TEXT[status])).toBeInTheDocument();
      expect(within(browser).queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it("says when push isn't set up on the server, without a test button", async () => {
    show(fakes({ serverReady: false }));
    const browser = await screen.findByRole('region', { name: 'This browser' });
    expect(await within(browser).findByText(PUSH_PROBLEM_TEXT['server-off'])).toBeInTheDocument();
    expect(within(browser).queryByRole('button')).not.toBeInTheDocument();
    expect(await screen.findByText('Firefox on Linux')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send a test notification' }),
    ).not.toBeInTheDocument();
  });
});

describe('NotificationSettings: browsers that get notifications', () => {
  it('lists each browser with its dates and removes one', async () => {
    const parts = fakes();
    show(parts);
    const rows = await screen.findAllByTestId('notifications-device');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Firefox on Linux');
    expect(rows[0]).toHaveTextContent('Added Oct 20, 2026 · Last used Oct 27, 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Firefox on Linux' }));
    await waitFor(() => expect(screen.queryByText('Firefox on Linux')).not.toBeInTheDocument());
    expect(parts.client.removeDevice).toHaveBeenCalledWith('sub-1');
    expect(screen.getByRole('heading', { name: 'Browsers that get notifications' })).toHaveFocus();
  });

  it('says when no browser gets notifications', async () => {
    show(fakes({ devices: [] }));
    expect(await screen.findByText('No browsers get notifications yet.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Send a test notification' }),
    ).not.toBeInTheDocument();
  });

  it('sends a test notification and says what happened', async () => {
    const parts = fakes();
    show(parts);
    const button = await screen.findByRole('button', { name: 'Send a test notification' });
    fireEvent.click(button);
    expect((await screen.findAllByText('Sent to 2 browsers.')).length).toBeGreaterThan(0);

    parts.client.sendTest.mockRejectedValueOnce(
      new ApiError(429, 'rate_limited', 'A test notification was just sent. Wait a moment.'),
    );
    await waitFor(() => expect(button).not.toHaveAttribute('aria-busy'));
    fireEvent.click(button);
    expect(
      (await screen.findAllByText('A test notification was just sent. Wait a moment.')).length,
    ).toBeGreaterThan(0);
    expect(parts.client.sendTest).toHaveBeenCalledTimes(2);
  });
});
