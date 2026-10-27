import { BUTTON_MESSAGES } from '@carehub/extras/templates/buttons';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api';
import { ButtonBlock } from './button-block';
import { BUTTON_ID, buttonResponse, COPY_ID, PAGE_ID, RUN_ID } from './fixtures';
import { fakeButtons, fakeSteps, pressAnswer, renderButtons, undoWindow } from './test-utils';

const notes = { type: 'paragraph', content: [{ type: 'text', text: 'Call notes' }] };

function renderBlock({
  client = fakeButtons(),
  steps = fakeSteps(),
  editable = true,
  onCopied = vi.fn(),
} = {}) {
  renderButtons(
    <ButtonBlock
      buttonId={BUTTON_ID}
      pageId={PAGE_ID}
      editable={editable}
      onCopied={onCopied}
      steps={steps}
    />,
    client,
  );
  return { client, steps, onCopied };
}

describe('the button block', () => {
  it('runs the steps, shows Done and undoes them, on the server and on the page', async () => {
    const client = fakeButtons({
      press: vi.fn(async () =>
        pressAnswer({
          pageSteps: [{ index: 0, kind: 'insert_blocks', where: 'below', blocks: [notes] }],
          changed: true,
          undoUntil: undoWindow(),
        }),
      ),
    });
    const { steps } = renderBlock({ client });
    fireEvent.click(await screen.findByRole('button', { name: 'Start intake' }));

    await waitFor(() => expect(client.press).toHaveBeenCalledWith(BUTTON_ID, { pageId: PAGE_ID }));
    expect(steps.insertBlocks).toHaveBeenCalledWith('below', [notes]);
    expect(await screen.findByText('Done ·')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(client.undo).toHaveBeenCalledWith(RUN_ID));
    expect(steps.takeOut).toHaveBeenCalled();
    expect(await screen.findByText('Undone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });

  it('says which step failed and why', async () => {
    const client = fakeButtons({
      press: vi.fn(async () =>
        pressAnswer({ failure: { step: 2, message: BUTTON_MESSAGES.cantEditPage } }),
      ),
    });
    renderBlock({ client });
    fireEvent.click(await screen.findByRole('button', { name: 'Start intake' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Couldn’t finish step 2: ${BUTTON_MESSAGES.cantEditPage}`,
    );
    expect(screen.queryByText('Done ·')).not.toBeInTheDocument();
  });

  it('asks first, then goes on from the step after the question', async () => {
    const press = vi
      .fn()
      .mockResolvedValueOnce(
        pressAnswer({
          confirm: {
            from: 2,
            title: 'Send to everyone?',
            message: 'The whole team gets a notice.',
            confirmLabel: 'Send',
          },
        }),
      )
      .mockResolvedValueOnce(
        pressAnswer({ changed: true, messagesSent: 1, undoUntil: undoWindow() }),
      );
    const { client } = renderBlock({ client: fakeButtons({ press }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Start intake' }));

    const dialog = await screen.findByRole('dialog', { name: 'Send to everyone?' });
    expect(within(dialog).getByText('The whole team gets a notice.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(client.press).toHaveBeenLastCalledWith(BUTTON_ID, {
        pageId: PAGE_ID,
        runId: RUN_ID,
        from: 2,
      }),
    );
    expect(await screen.findByText('Done ·')).toBeInTheDocument();
  });

  it('stops the run on Cancel', async () => {
    const client = fakeButtons({
      press: vi.fn(async () =>
        pressAnswer({
          confirm: { from: 1, title: 'Are you sure?', message: '', confirmLabel: 'Continue' },
        }),
      ),
    });
    renderBlock({ client });
    fireEvent.click(await screen.findByRole('button', { name: 'Start intake' }));
    const dialog = await screen.findByRole('dialog', { name: 'Are you sure?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith(RUN_ID));
    expect(client.press).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('is greyed out, with the reason, for people who can’t press it', async () => {
    const client = fakeButtons({
      get: vi.fn(async () =>
        buttonResponse({ canEdit: false, canPress: false, reason: BUTTON_MESSAGES.editorsOnly }),
      ),
    });
    renderBlock({ client });
    const button = await screen.findByRole('button', { name: 'Start intake' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription(
      `When pressed: open example.org. ${BUTTON_MESSAGES.editorsOnly}`,
    );
    fireEvent.click(button);
    expect(client.press).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Edit button' })).not.toBeInTheDocument();
  });

  it('keeps the page’s own copy of the button', async () => {
    const onCopied = vi.fn();
    renderBlock({
      client: fakeButtons({ get: vi.fn(async () => buttonResponse({ id: COPY_ID })) }),
      onCopied,
    });
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(COPY_ID));
  });

  it('says a removed button was removed, to people editing the page', async () => {
    const client = fakeButtons({
      get: vi.fn(async () => {
        throw new ApiError(404, 'not_found', 'Not found.');
      }),
    });
    renderBlock({ client });
    expect(await screen.findByText('This button was removed.')).toBeInTheDocument();
  });
});
