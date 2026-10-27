import { describeButton, type ButtonAction } from '@carehub/extras/templates/buttons';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BUTTON_ID, buttonResponse, PAGE_ID, settings } from './fixtures';
import { ButtonSettingsDialog } from './settings';
import { fakeButtons, renderButtons } from './test-utils';

// The blocks editor isn't part of these tests.
vi.mock('./blocks-field', () => ({ BlocksField: () => null, inEditorMenu: () => false }));

const link: ButtonAction = { kind: 'open_link', url: 'https://example.org/intake' };
const ask: ButtonAction = {
  kind: 'confirm',
  title: 'Are you sure?',
  message: '',
  confirmLabel: 'Continue',
};

async function openSettings(actions: ButtonAction[] = []) {
  const client = fakeButtons();
  const onClose = vi.fn();
  renderButtons(
    <ButtonSettingsDialog
      button={buttonResponse({ settings: settings({ actions }) })}
      onClose={onClose}
    />,
    client,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Edit button' });
  return { client, onClose, dialog };
}

/** Opens Add action with the keyboard, as Radix menus expect, and picks a kind of step. */
async function addAction(dialog: HTMLElement, name: string) {
  fireEvent.keyDown(within(dialog).getByRole('button', { name: 'Add action' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

describe('the button settings', () => {
  it('adds steps, moves them and saves them in their new order', async () => {
    const { client, onClose, dialog } = await openSettings();
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Open intake' } });

    await addAction(dialog, 'Open a link');
    fireEvent.change(within(dialog).getByLabelText('Link'), { target: { value: link.url } });
    await addAction(dialog, 'Show a confirmation');
    expect(within(dialog).getByText(describeButton({ actions: [link, ask] }))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move step 2 up' }));
    expect(within(dialog).getByRole('heading', { name: '1. Show a confirmation' })).toBeVisible();
    expect(within(dialog).getByText(describeButton({ actions: [ask, link] }))).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.save).toHaveBeenCalledWith(BUTTON_ID, PAGE_ID, {
      label: 'Open intake',
      icon: '🚀',
      color: 'default',
      who: 'editors',
      actions: [ask, link],
    });
  });

  it('removes a step', async () => {
    const { dialog } = await openSettings([link, ask]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove step 1' }));
    expect(within(dialog).queryByRole('heading', { name: '1. Open a link' })).toBeNull();
    expect(within(dialog).getByRole('heading', { name: '1. Show a confirmation' })).toBeVisible();
  });

  it('says which step needs fixing, without saving', async () => {
    const { client, dialog } = await openSettings();
    await addAction(dialog, 'Add a row');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Step 1: Paste the link to a database.',
    );
    expect(client.save).not.toHaveBeenCalled();
  });
});
