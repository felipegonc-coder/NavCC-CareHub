import type { ClaudeSettingsView } from '@carehub/extras/claude/settings';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ClaudeSettings, { monthName } from './ClaudeSettings';

const realFetch = globalThis.fetch;

const allOff = {
  writing_help: false,
  assistant: false,
  fields: false,
  meeting_summary: false,
  learning_help: false,
};
const noUse = { writing_help: 0, assistant: 0, fields: 0, meeting_summary: 0, learning_help: 0 };

function settings(overrides: Partial<ClaudeSettingsView> = {}): ClaudeSettingsView {
  return {
    keySet: true,
    model: 'claude-fictional-1',
    navApproved: false,
    switches: allOff,
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
    const body = JSON.parse(String(init?.body)) as Partial<ClaudeSettingsView>;
    puts.push(body);
    if (options.putStatus) return refusal(options.putStatus, 'unexpected');
    current = { ...current, ...body, switches: { ...current.switches, ...body.switches } };
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
  it("shows whether the server has a key and the model, and this month's use", async () => {
    fakeServer(settings());
    renderSettings();
    expect(
      await screen.findByText('The server has a Claude key. Model: claude-fictional-1.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '1,234 of 3,000 requests used in October 2026. At the limit, Claude stops until next month.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
  });

  it('says how to add the key when the server has none', async () => {
    fakeServer(settings({ keySet: false }));
    renderSettings();
    expect(await screen.findByText(/The server has no Claude key yet\./)).toBeInTheDocument();
  });

  it('keeps the switches off until Nav has given the OK, then saves the OK', async () => {
    const { puts } = fakeServer(settings());
    renderSettings();
    const writing = await screen.findByRole('switch', { name: 'Writing help in pages' });
    expect(writing).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Nav has given the OK' }));
    await waitFor(() => expect(writing).toBeEnabled());
    expect(puts).toEqual([{ navApproved: true }]);
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('saves one switch at a time, sending only what changed', async () => {
    const { puts } = fakeServer(settings({ navApproved: true }));
    renderSettings();
    const assistant = await screen.findByRole('switch', { name: 'Assistant panel' });
    expect(assistant).not.toBeChecked();
    fireEvent.click(assistant);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved'));
    expect(puts).toEqual([{ switches: { assistant: true } }]);
    expect(assistant).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Meeting summaries' })).not.toBeChecked();
  });

  it('names the field when saving fails and shows what is saved', async () => {
    fakeServer(settings({ navApproved: true }), { putStatus: 500 });
    renderSettings();
    const fields = await screen.findByRole('switch', { name: 'Claude fields in databases' });
    fireEvent.click(fields);
    const failed = 'Couldn\'t save "Claude fields in databases". Something went wrong. Try again.';
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(failed));
    expect(fields).toHaveAccessibleDescription(expect.stringContaining(failed));
    expect(fields).not.toBeChecked();
  });

  it('shows only "You don\'t have access to this." to people who aren\'t Admins', async () => {
    fakeServer(settings(), { getStatus: 403 });
    renderSettings();
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
    expect(screen.queryByText(/claude-fictional-1/)).not.toBeInTheDocument();
  });

  it('shows the access message when access goes while the section is open', async () => {
    fakeServer(settings({ navApproved: true }), { putStatus: 403 });
    renderSettings();
    fireEvent.click(await screen.findByRole('switch', { name: 'Learning help' }));
    expect(await screen.findByText("You don't have access to this.")).toBeInTheDocument();
  });

  it('names the month', () => {
    expect(monthName('2026-10')).toBe('October 2026');
    expect(monthName('2027-01')).toBe('January 2027');
  });
});
