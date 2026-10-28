import {
  CLAUDE_CONFIRM_LABEL,
  CLAUDE_CONFIRM_NOTE,
  CLAUDE_FEATURE_SENDS,
} from '@carehub/extras/claude';
import type { ClaudeSettingsUpdate, ClaudeSettingsView } from '@carehub/extras/claude/settings';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClaudeSettings, { changedLine, LIMIT_ERROR, monthName } from './ClaudeSettings';

const realFetch = globalThis.fetch;

const allOff = {
  writing_help: false,
  assistant: false,
  fields: false,
  meeting_summary: false,
  learning_help: false,
};
const neverChanged = {
  writing_help: null,
  assistant: null,
  fields: null,
  meeting_summary: null,
  learning_help: null,
};
const noUse = { writing_help: 0, assistant: 0, fields: 0, meeting_summary: 0, learning_help: 0 };
// Midday in Denver, so the day is Oct 27 in any US time zone.
const AT = '2026-10-27T18:00:00.000Z';

function settings(overrides: Partial<ClaudeSettingsView> = {}): ClaudeSettingsView {
  return {
    keySet: true,
    model: 'claude-test',
    switches: allOff,
    lastChanged: neverChanged,
    chatRetentionDays: null,
    usage: {
      month: '2026-10',
      requests: 1234,
      monthlyRequests: 3000,
      byFeature: { ...noUse, writing_help: 1200, assistant: 34 },
    },
    ...overrides,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const refusal = (status: number, code: string) =>
  json(status, { error: { code, message: 'Something went wrong. Try again.' } });

/** /api/claude/settings with `start` saved; PUTs answer `putStatus` when it's set. */
function fakeServer(
  start: ClaudeSettingsView,
  options: { getStatus?: number; putStatus?: number } = {},
) {
  let current = start;
  const puts: unknown[] = [];
  globalThis.fetch = vi.fn<typeof fetch>(async (input, init) => {
    const method = init?.method ?? 'GET';
    if (String(input) !== '/api/claude/settings') return refusal(404, 'not_found');
    if (method === 'GET') {
      return options.getStatus ? refusal(options.getStatus, 'forbidden') : json(200, current);
    }
    const body = JSON.parse(String(init?.body)) as ClaudeSettingsUpdate;
    puts.push(body);
    if (options.putStatus) return refusal(options.putStatus, 'unexpected');
    current = {
      ...current,
      switches: { ...current.switches, ...body.switches },
      chatRetentionDays:
        body.chatRetentionDays === undefined ? current.chatRetentionDays : body.chatRetentionDays,
      usage: {
        ...current.usage,
        monthlyRequests: body.monthlyRequests ?? current.usage.monthlyRequests,
      },
    };
    return json(200, current);
  });
  return { puts };
}

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ClaudeSettings />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('Settings → Claude', () => {
  it("shows that the key is set and the model, and this month's use", async () => {
    fakeServer(settings());
    renderSettings();
    expect(await screen.findByText('Key set. Model: claude-test.')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1,234 of 3,000 requests used in October 2026. At the limit, Claude stops until the 1st of next month, or until the limit is raised.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it("says how to add the key when there's none, and keeps the switches from turning on", async () => {
    fakeServer(settings({ keySet: false }));
    renderSettings();
    expect(
      await screen.findByText(
        "No key. Add it to the server's settings file, then restart Care Hub.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Writing help' })).toBeDisabled();
  });

  it('says what each switch sends, and asks before turning one on', async () => {
    const { puts } = fakeServer(settings());
    renderSettings();
    const writing = await screen.findByRole('switch', { name: 'Writing help' });
    expect(writing).toHaveAccessibleDescription(
      "Writing help sends the text people select, and the text around it, to Anthropic's Claude.",
    );
    fireEvent.click(writing);

    const confirm = await screen.findByRole('dialog', { name: 'Turn on Writing help?' });
    expect(confirm).toHaveAccessibleDescription(
      `${CLAUDE_FEATURE_SENDS.writing_help} ${CLAUDE_CONFIRM_NOTE}`,
    );
    const turnOn = screen.getByRole('button', { name: 'Turn on' });
    expect(turnOn).toBeDisabled();
    expect(puts).toEqual([]);
    fireEvent.click(screen.getByRole('checkbox', { name: CLAUDE_CONFIRM_LABEL }));
    expect(turnOn).toBeEnabled();
    fireEvent.click(turnOn);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(puts).toEqual([{ switches: { writing_help: true }, confirmed: true }]);
    expect(writing).toBeChecked();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Meeting summary' })).not.toBeChecked();
  });

  it('leaves the switch off and sends nothing when the confirm is cancelled', async () => {
    const { puts } = fakeServer(settings());
    renderSettings();
    const assistant = await screen.findByRole('switch', { name: 'Assistant' });
    fireEvent.click(assistant);
    fireEvent.click(await screen.findByRole('checkbox', { name: CLAUDE_CONFIRM_LABEL }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(assistant).not.toBeChecked();
    expect(puts).toEqual([]);

    // The next confirm starts unticked.
    fireEvent.click(assistant);
    expect(await screen.findByRole('checkbox', { name: CLAUDE_CONFIRM_LABEL })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  });

  it('turns a switch off at once, without asking', async () => {
    const { puts } = fakeServer(settings({ switches: { ...allOff, assistant: true } }));
    renderSettings();
    const assistant = await screen.findByRole('switch', { name: 'Assistant' });
    expect(assistant).toBeChecked();
    fireEvent.click(assistant);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(puts).toEqual([{ switches: { assistant: false } }]);
    expect(assistant).not.toBeChecked();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says who last turned each switch on or off, and when', async () => {
    fakeServer(
      settings({
        switches: { ...allOff, writing_help: true },
        lastChanged: {
          ...neverChanged,
          writing_help: { by: 'Avery Lin', at: AT },
          fields: { by: null, at: AT },
        },
      }),
    );
    renderSettings();
    expect(await screen.findByRole('switch', { name: 'Writing help' })).toHaveAccessibleDescription(
      expect.stringContaining('Turned on by Avery Lin on Oct 27, 2026.'),
    );
    expect(screen.getByRole('switch', { name: 'Claude fields' })).toHaveAccessibleDescription(
      expect.stringContaining('Turned off by a former member on Oct 27, 2026.'),
    );
    expect(changedLine(null, true)).toBeNull();
  });

  it('names the field when saving fails and shows what is saved', async () => {
    fakeServer(settings({ switches: { ...allOff, fields: true } }), { putStatus: 500 });
    renderSettings();
    const fields = await screen.findByRole('switch', { name: 'Claude fields' });
    fireEvent.click(fields);
    const failed = 'Couldn\'t save "Claude fields". Something went wrong. Try again.';
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(failed));
    expect(fields).toHaveAccessibleDescription(expect.stringContaining(failed));
    expect(fields).toBeChecked();
  });

  it('saves the monthly limit on Enter, and refuses anything but a whole number', async () => {
    const { puts } = fakeServer(settings());
    renderSettings();
    const limit = await screen.findByRole('spinbutton', { name: 'Monthly limit' });
    expect(limit).toHaveValue(3000);
    fireEvent.change(limit, { target: { value: '5000' } });
    fireEvent.keyDown(limit, { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(puts).toEqual([{ monthlyRequests: 5000 }]);
    expect(screen.getByText(/^1,234 of 5,000 requests used in October 2026\./)).toBeInTheDocument();

    for (const value of ['12.5', '-1', '1000001', '']) {
      fireEvent.change(limit, { target: { value } });
      fireEvent.blur(limit);
      expect(limit).toHaveAccessibleDescription(expect.stringContaining(LIMIT_ERROR));
    }
    expect(LIMIT_ERROR).toBe('Use a whole number from 0 to 1,000,000.');
    expect(puts).toHaveLength(1);

    // Leaving it as it was saves nothing.
    fireEvent.change(limit, { target: { value: '5000' } });
    fireEvent.blur(limit);
    expect(limit).not.toHaveAccessibleDescription(expect.stringContaining(LIMIT_ERROR));
    expect(puts).toHaveLength(1);
  });

  it('shows only "You don\'t have access to this." to people who aren\'t Admins', async () => {
    fakeServer(settings(), { getStatus: 403 });
    renderSettings();
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
    expect(screen.queryByText(/claude-test/)).not.toBeInTheDocument();
  });

  it('shows the access message when access goes while the section is open', async () => {
    fakeServer(settings({ switches: { ...allOff, learning_help: true } }), { putStatus: 403 });
    renderSettings();
    fireEvent.click(await screen.findByRole('switch', { name: 'Learning help' }));
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
  });

  it('names the month', () => {
    expect(monthName('2026-10')).toBe('October 2026');
    expect(monthName('2027-01')).toBe('January 2027');
  });
});
