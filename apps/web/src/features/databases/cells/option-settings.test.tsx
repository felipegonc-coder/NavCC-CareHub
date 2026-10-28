import type { DatabaseMeta, Id, Property, SelectOption } from '@carehub/databases';
import { nextOptionColor, OPTION_MESSAGES } from '@carehub/databases/options';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, jobsRows, PROPS, queryRow } from '../fixtures';
import { PROPERTY_TEXT, SETTINGS_TEXT } from './messages';
import type { PropertyActions } from './property-actions';
import { PropertySettings } from './property-settings';
import { settle } from './test-helpers';

const db = jobsDatabase();
const rows = jobsRows().map(queryRow);

function property(id: Id): Property {
  const found = db.properties.find((p) => p.id === id);
  if (!found) throw new Error(`no property ${id}`);
  return found;
}

/** The settings of one property; changes show at once, as they do on their way to the server. */
function renderOptions(id: Id, meta: DatabaseMeta = db) {
  const actions = {
    create: vi.fn<PropertyActions['create']>(() => Promise.resolve(db)),
    update: vi.fn<PropertyActions['update']>(() => Promise.resolve(db)),
    remove: vi.fn<PropertyActions['remove']>(() => Promise.resolve(db)),
    restore: vi.fn<PropertyActions['restore']>(() => Promise.resolve(db)),
    duplicate: vi.fn<PropertyActions['duplicate']>(() => Promise.resolve(db)),
  };
  const onError = vi.fn();
  render(
    <PropertySettings
      meta={meta}
      property={property(id)}
      actions={actions}
      rows={rows}
      onError={onError}
    />,
  );
  return { actions, onError };
}

type Actions = ReturnType<typeof renderOptions>['actions'];

function savedOptions(actions: Actions): readonly SelectOption[] {
  const config = actions.update.mock.lastCall?.[1].config;
  if (config?.type !== 'select') throw new Error('no options saved');
  return config.options;
}

function optionsOf(id: Id): readonly SelectOption[] {
  const config = property(id).config;
  return config.type === 'select' ? config.options : [];
}

const names = (options: readonly SelectOption[]) => options.map((o) => o.name);
const field = (name: string) => screen.getByRole('textbox', { name });
const button = (name: string) => screen.getByRole('button', { name });

function type(name: string, text: string) {
  fireEvent.change(field(name), { target: { value: text } });
  fireEvent.keyDown(field(name), { key: 'Enter' });
}

/** Opens an option's menu (the ⋯ button) and returns it. */
async function openMenu(option: string) {
  fireEvent.keyDown(button(SETTINGS_TEXT.editOption(option)), { key: 'Enter' });
  await settle();
  return screen.getByRole('menu');
}

/** Picks Delete option in the option's menu and returns the confirm. */
async function askDelete(option: string) {
  fireEvent.click(
    within(await openMenu(option)).getByRole('menuitem', { name: SETTINGS_TEXT.deleteOption }),
  );
  await settle();
  return screen.getByRole('dialog', { name: PROPERTY_TEXT.deleteTitle(option) });
}

describe('OptionSettings: Select and Multi-select', () => {
  it('lists the options in order, each with its name and a menu', () => {
    renderOptions(PROPS.priority);
    expect(screen.getByRole('heading', { name: SETTINGS_TEXT.options })).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    ['High', 'Medium', 'Low'].forEach((name, i) => {
      const item = within(items[i] ?? document.body);
      expect(item.getByRole('textbox', { name: SETTINGS_TEXT.renameOption(name) })).toHaveValue(
        name,
      );
      expect(
        item.getByRole('button', { name: SETTINGS_TEXT.editOption(name) }),
      ).toBeInTheDocument();
    });
  });

  it('renames an option on Enter, and says why a name will not do', () => {
    const { actions } = renderOptions(PROPS.priority);
    type(SETTINGS_TEXT.renameOption('High'), '  Urgent ');
    expect(names(savedOptions(actions))).toEqual(['Urgent', 'Medium', 'Low']);
    expect(field(SETTINGS_TEXT.renameOption('Urgent'))).toHaveValue('Urgent');

    type(SETTINGS_TEXT.renameOption('Low'), 'Medium');
    expect(screen.getByRole('alert')).toHaveTextContent(OPTION_MESSAGES.taken);
    expect(field(SETTINGS_TEXT.renameOption('Low'))).toHaveAttribute('aria-invalid', 'true');
    type(SETTINGS_TEXT.renameOption('Low'), 'Low, later');
    expect(screen.getByRole('alert')).toHaveTextContent(OPTION_MESSAGES.comma);
    expect(actions.update).toHaveBeenCalledTimes(1);
  });

  it('adds an option in the next color and clears the field for another', () => {
    const { actions } = renderOptions(PROPS.priority);
    const before = optionsOf(PROPS.priority);
    type(SETTINGS_TEXT.addOption, 'Urgent');
    expect(savedOptions(actions)).toEqual([
      ...before,
      { id: expect.any(String), name: 'Urgent', color: nextOptionColor(before) },
    ]);
    expect(field(SETTINGS_TEXT.addOption)).toHaveValue('');
    expect(field(SETTINGS_TEXT.renameOption('Urgent'))).toBeInTheDocument();

    type(SETTINGS_TEXT.addOption, 'High');
    expect(screen.getByRole('alert')).toHaveTextContent(OPTION_MESSAGES.taken);
    expect(actions.update).toHaveBeenCalledTimes(1);
  });

  it('recolors an option from its menu', async () => {
    const { actions } = renderOptions(PROPS.priority);
    const menu = await openMenu('High');
    expect(within(menu).getByText(SETTINGS_TEXT.color)).toBeInTheDocument();
    expect(within(menu).getByRole('menuitemradio', { name: 'Red' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Blue' }));
    expect(savedOptions(actions)[0]).toEqual({
      id: expect.any(String),
      name: 'High',
      color: 'blue',
    });
    await settle();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('deletes an option after saying how many rows use it', async () => {
    const { actions } = renderOptions(PROPS.priority);
    const dialog = await askDelete('High');
    expect(dialog).toHaveTextContent('2 rows use this option. It will be cleared from them.');
    expect(actions.update).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: PROPERTY_TEXT.delete }));
    await settle();
    await settle();
    expect(names(savedOptions(actions))).toEqual(['Medium', 'Low']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(field(SETTINGS_TEXT.renameOption('Medium'))).toHaveFocus();
  });

  it('keeps the option when the delete is cancelled', async () => {
    const { actions } = renderOptions(PROPS.priority);
    const dialog = await askDelete('Low');
    expect(dialog).toHaveTextContent('1 row uses this option. It will be cleared from that row.');
    fireEvent.click(within(dialog).getByRole('button', { name: PROPERTY_TEXT.cancel }));
    await settle();
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button(SETTINGS_TEXT.editOption('Low'))).toHaveFocus();
    expect(actions.update).not.toHaveBeenCalled();
  });

  it('keeps the confirm open when the server refuses the delete', async () => {
    const { actions, onError } = renderOptions(PROPS.priority);
    const refused = new Error('Refused');
    actions.update.mockRejectedValue(refused);
    const dialog = await askDelete('Medium');
    fireEvent.click(within(dialog).getByRole('button', { name: PROPERTY_TEXT.delete }));
    await settle();
    expect(onError).toHaveBeenCalledWith(refused);
    expect(
      screen.getByRole('dialog', { name: PROPERTY_TEXT.deleteTitle('Medium') }),
    ).toBeInTheDocument();
  });

  it('only lists the options when the database is locked', () => {
    renderOptions(PROPS.priority, { ...db, locked: true });
    expect(field(SETTINGS_TEXT.renameOption('High'))).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: SETTINGS_TEXT.editOption('High') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: SETTINGS_TEXT.addOption }),
    ).not.toBeInTheDocument();
  });
});
