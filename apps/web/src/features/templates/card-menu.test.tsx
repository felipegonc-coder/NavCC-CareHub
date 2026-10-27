import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TemplateCardMenu } from './card-menu';
import { card, CARDS, GALLERY, LAUNCH_ID, renderAt } from './test-utils';

const launch = CARDS[0]!;

/** Opens the "…" menu with the keyboard, as Radix menus expect, and picks an item. */
async function choose(name: string, item: string) {
  const trigger = await screen.findByRole('button', { name: `More actions for ${name}` });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

function renderMenu(template = launch) {
  return renderAt(
    <TemplateCardMenu card={template} spaces={GALLERY.spaces} categories={GALLERY.categories} />,
  );
}

describe('the template card menu', () => {
  it('renames a workspace template', async () => {
    const { client } = renderMenu();
    await choose('Launch plan', 'Rename');
    const dialog = await screen.findByRole('dialog', { name: 'Rename template' });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: 'Launch' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.update).toHaveBeenCalledWith(LAUNCH_ID, {
        name: 'Launch',
        description: 'A launch with its agenda and tickets.',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('changes the category', async () => {
    const { client } = renderMenu();
    await choose('Launch plan', 'Change category');
    const dialog = await screen.findByRole('dialog', { name: 'Change category' });
    fireEvent.change(within(dialog).getByLabelText(/^Category/), { target: { value: 'Team' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(client.update).toHaveBeenCalledWith(LAUNCH_ID, { category: 'Team' }),
    );
  });

  it('shows who can use it', async () => {
    renderMenu();
    await choose('Launch plan', 'Who can use it');
    const dialog = await screen.findByRole('dialog', { name: 'Who can use it' });
    expect(within(dialog).getByRole('combobox', { name: 'Who can use it' })).toBeInTheDocument();
  });

  it('deletes after asking, and says pages made from it stay', async () => {
    const { client } = renderMenu();
    await choose('Launch plan', 'Delete');
    const dialog = await screen.findByRole('dialog', { name: 'Delete Launch plan?' });
    expect(dialog).toHaveTextContent('Pages made from it stay as they are.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(client.remove).toHaveBeenCalledWith(LAUNCH_ID));
  });

  it('hides a starter for everyone, or shows it again', async () => {
    const huddle = card({ id: 'weekly-huddle', name: 'Weekly huddle', canManage: true });
    const { client } = renderMenu(huddle);
    await choose('Weekly huddle', 'Hide for everyone');
    await waitFor(() => expect(client.setHidden).toHaveBeenCalledWith('weekly-huddle', true));
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
  });

  it('offers Show for everyone on a hidden starter', async () => {
    const hidden = card({
      id: 'weekly-huddle',
      name: 'Weekly huddle',
      canManage: true,
      hidden: true,
    });
    const { client } = renderMenu(hidden);
    await choose('Weekly huddle', 'Show for everyone');
    await waitFor(() => expect(client.setHidden).toHaveBeenCalledWith('weekly-huddle', false));
  });
});
