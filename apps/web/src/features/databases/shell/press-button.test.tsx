import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageUrl } from '@carehub/shared';
import { ApiError } from '../api';
import type { LayoutProps } from '../contract';
import { JOBS_ID, mockClient, renderWithDatabase, testViewer } from '../test-utils';
import { DatabaseView, type DatabaseViewProps } from './database-view';
import { probe } from './test-layout';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

/** A Button property's id: the shell sends it as it is. */
const BUTTON = 'prop-text-customer';
const UNTIL = '2026-10-28T15:00:08.000Z';
const CONFIRM = {
  status: 'confirm',
  step: 1,
  title: 'Close this job?',
  message: 'The customer gets a text that the job is done.',
  confirmLabel: 'Close job',
} as const;

async function show(client = mockClient(), props: Partial<DatabaseViewProps> = {}) {
  renderWithDatabase(<DatabaseView databaseId={JOBS_ID} viewer={testViewer()} {...props} />, {
    client,
  });
  await screen.findByTestId('probe-layout');
  return client;
}

function drawn(): LayoutProps {
  if (!probe.props) throw new Error('The layout has not drawn yet.');
  return probe.props;
}

/** Presses the button on Kitchen sink; the outcome says whether the run was done. */
function press(): Promise<'done' | 'stopped'> {
  let outcome: Promise<'done' | 'stopped'> = Promise.resolve('stopped');
  act(() => {
    outcome = drawn()
      .actions.pressButton('row-sink', BUTTON)
      .then(
        () => 'done' as const,
        () => 'stopped' as const,
      );
  });
  return outcome;
}

async function settle(outcome: Promise<'done' | 'stopped'>) {
  let result: 'done' | 'stopped' | undefined;
  await act(async () => {
    result = await outcome;
  });
  return result;
}

afterEach(() => vi.restoreAllMocks());

describe('pressing a button', () => {
  it('says Done and offers Undo, which notes what it can’t take back', async () => {
    const client = await show();
    client.pressButton.mockResolvedValueOnce({
      status: 'done',
      runId: 'run-7',
      message: 'Done · Undo',
      undoUntil: UNTIL,
      open: [],
    });
    client.undoButtonRun.mockResolvedValueOnce({ kept: 0, note: "Sent messages can't be unsent." });
    expect(await settle(press())).toBe('done');
    expect(client.pressButton).toHaveBeenCalledWith(JOBS_ID, 'row-sink', BUTTON, 0);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent(/^DoneUndo$/);
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(client.undoButtonRun).toHaveBeenCalledWith(JOBS_ID, 'run-7'));
    expect(await screen.findByText("Sent messages can't be unsent.")).toBeInTheDocument();
  });

  it('shows nothing when the run changed nothing', async () => {
    const client = await show();
    expect(await settle(press())).toBe('done');
    expect(client.pressButton).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('asks at a confirmation step, and Continue presses again one step further', async () => {
    const client = await show();
    client.pressButton.mockResolvedValueOnce(CONFIRM);
    const outcome = press();
    const dialog = await screen.findByRole('dialog', { name: CONFIRM.title });
    expect(within(dialog).getByText(CONFIRM.message)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close job' }));
    expect(await settle(outcome)).toBe('done');
    expect(client.pressButton.mock.calls).toEqual([
      [JOBS_ID, 'row-sink', BUTTON, 0],
      [JOBS_ID, 'row-sink', BUTTON, 1],
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('stops with nothing changed on Cancel', async () => {
    const client = await show();
    client.pressButton.mockResolvedValueOnce(CONFIRM);
    const outcome = press();
    const dialog = await screen.findByRole('dialog', { name: CONFIRM.title });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await settle(outcome)).toBe('stopped');
    expect(client.pressButton).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it("says why a run failed, in the server's words", async () => {
    const message = "Couldn't finish step 2: Tickets is in Trash.";
    const client = await show();
    client.pressButton.mockResolvedValueOnce({
      status: 'failed',
      runId: 'run-8',
      message,
      undoUntil: null,
      open: [],
    });
    expect(await settle(press())).toBe('stopped');
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent(message);
    expect(within(toast).queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('says why a press was refused', async () => {
    const client = await show();
    client.pressButton.mockRejectedValueOnce(
      new ApiError(403, 'forbidden', "You can't add rows to Tickets."),
    );
    expect(await settle(press())).toBe('stopped');
    expect(screen.getByRole('status')).toHaveTextContent("You can't add rows to Tickets.");
  });

  it('opens what the run opens, in step order: web links only, pages as rows open', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const onOpenRow = vi.fn();
    const client = await show(mockClient(), { onOpenRow });
    client.pressButton.mockResolvedValueOnce({
      status: 'done',
      runId: 'run-9',
      message: null,
      undoUntil: null,
      open: [
        { kind: 'link', url: 'https://example.com/drain-guide' },
        { kind: 'link', url: 'javascript:alert(1)' },
        { kind: 'page', pageId: 'page-checklist', openIn: 'new_tab' },
        { kind: 'page', pageId: 'row-boiler', openIn: 'side_peek' },
      ],
    });
    expect(await settle(press())).toBe('done');
    expect(open.mock.calls).toEqual([
      ['https://example.com/drain-guide', '_blank', 'noopener,noreferrer'],
      [pageUrl('page-checklist'), '_blank', 'noopener'],
    ]);
    expect(onOpenRow).toHaveBeenCalledWith('row-boiler', 'side_peek');
  });
});
