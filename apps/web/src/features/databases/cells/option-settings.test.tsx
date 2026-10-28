import type { DatabaseMeta, Id, Property, SelectOption } from '@carehub/databases';
import { nextOptionColor, OPTION_MESSAGES } from '@carehub/databases/options';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, jobsRows, PROPS, queryRow, STATUS } from '../fixtures';
import { PROPERTY_TEXT, SETTINGS_TEXT, STATUS_GROUP_LABELS } from './messages';
import type { PropertyActions } from './property-actions';
import { PropertySettings } from './property-settings';
import { pointer, settle } from './test-helpers';

const db = jobsDatabase();
const rows = jobsRows().map(queryRow);

function property(id: Id): Property {
  const found = db.properties.find((p) => p.id === id);
  if (!found) throw new Error(`no property ${id}`);
  return found;
}

/** The settings of one property; changes show at once, as they do on their way to the server. */
function renderOptions(id: Id, meta: DatabaseMeta = db, moreRows = false) {
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
      moreRows={moreRows}
      onError={onError}
    />,
  );
  return { actions, onError };
}

type Actions = ReturnType<typeof renderOptions>['actions'];

function lastConfig(actions: Actions) {
  const config = actions.update.mock.lastCall?.[1].config;
  if (!config) throw new Error('no settings saved');
  return config;
}

function savedOptions(actions: Actions): readonly SelectOption[] {
  const config = lastConfig(actions);
  if (config.type !== 'select') throw new Error(`saved a ${config.type}`);
  return config.options;
}

function savedStatus(actions: Actions) {
  const config = lastConfig(actions);
  if (config.type !== 'status') throw new Error(`saved a ${config.type}`);
  return config;
}

/** A property's options as they are in the fixtures. */
function optionsOf(id: Id): readonly SelectOption[] {
  const config = property(id).config;
  return config.type === 'select' || config.type === 'status' ? config.options : [];
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

/** A press, move or release at a height on the page (as a MouseEvent: jsdom has no PointerEvent). */
describe('OptionSettings: Select and Multi-select', () => {
  it('lists the options in order, each with a handle, its name and a menu', () => {
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
        item.getByRole('button', { name: SETTINGS_TEXT.moveOption(name) }),
      ).toHaveAccessibleDescription(SETTINGS_TEXT.moveHint);
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

  it('moves an option one place with the arrow keys on its handle, keeping focus', () => {
    const { actions } = renderOptions(PROPS.priority);
    const handle = button(SETTINGS_TEXT.moveOption('High'));
    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(names(savedOptions(actions))).toEqual(['Medium', 'High', 'Low']);
    expect(button(SETTINGS_TEXT.moveOption('High'))).toHaveFocus();

    fireEvent.keyDown(button(SETTINGS_TEXT.moveOption('Medium')), { key: 'ArrowUp' });
    expect(actions.update).toHaveBeenCalledTimes(1);
  });

  it('moves an option by dragging its handle', () => {
    const { actions } = renderOptions(PROPS.priority);
    screen.getAllByRole('listitem').forEach((item, i) => {
      item.getBoundingClientRect = () => ({ top: i * 40, height: 40 }) as DOMRect;
    });
    const handle = button(SETTINGS_TEXT.moveOption('Low'));
    pointer(handle, 'pointerdown', 100);
    pointer(handle, 'pointermove', 50);
    pointer(handle, 'pointermove', 10);
    expect(actions.update).not.toHaveBeenCalled();
    pointer(handle, 'pointerup', 10);
    expect(names(savedOptions(actions))).toEqual(['Low', 'High', 'Medium']);
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
    expect(button(SETTINGS_TEXT.moveOption('Medium'))).toHaveFocus();
  });

  it('says "at least" when the view hasn’t loaded every row', async () => {
    renderOptions(PROPS.priority, db, true);
    expect(await askDelete('High')).toHaveAccessibleDescription(
      'At least 2 rows use this option. It will be cleared from all of them.',
    );
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
    expect(button(SETTINGS_TEXT.moveOption('High'))).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: SETTINGS_TEXT.editOption('High') }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: SETTINGS_TEXT.addOption }),
    ).not.toBeInTheDocument();
  });
});

describe('OptionSettings: Status', () => {
  it('shows To-do, In progress and Complete, and which option is the default', () => {
    renderOptions(PROPS.status);
    for (const group of ['todo', 'in_progress', 'complete'] as const) {
      expect(screen.getByRole('heading', { name: STATUS_GROUP_LABELS[group] })).toBeInTheDocument();
    }
    expect(screen.getByText(SETTINGS_TEXT.defaultHint)).toBeInTheDocument();
    expect(screen.getByText(SETTINGS_TEXT.isDefault).closest('li')).toContainElement(
      field(SETTINGS_TEXT.renameOption('Not started')),
    );
  });

  it('keeps at least one option in each group', async () => {
    renderOptions(PROPS.status);
    const menu = await openMenu('Done');
    expect(
      within(menu).getByRole('menuitem', { name: SETTINGS_TEXT.deleteOption }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(within(menu).getByText(SETTINGS_TEXT.keepOne)).toBeInTheDocument();
    expect(
      within(menu).getByRole('menuitem', { name: SETTINGS_TEXT.moveTo(STATUS_GROUP_LABELS.todo) }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('adds an option to a group, moves it to another and sets the default', async () => {
    const { actions } = renderOptions(PROPS.status);
    const addTo = SETTINGS_TEXT.addOptionTo(STATUS_GROUP_LABELS.in_progress);
    fireEvent.click(button(addTo));
    expect(field(addTo)).toHaveFocus();
    type(addTo, 'Waiting on parts');
    const inProgress = optionsOf(PROPS.status).filter((o) => o.id === STATUS.inProgress);
    const added = savedStatus(actions).options;
    expect(names(added)).toEqual(['Not started', 'In progress', 'Waiting on parts', 'Done']);
    expect(added[2]).toEqual({
      id: expect.any(String),
      name: 'Waiting on parts',
      color: nextOptionColor(inProgress),
      group: 'in_progress',
    });
    expect(field(addTo)).toHaveValue('');
    fireEvent.blur(field(addTo));
    expect(screen.queryByRole('textbox', { name: addTo })).not.toBeInTheDocument();

    fireEvent.click(
      within(await openMenu('Waiting on parts')).getByRole('menuitem', {
        name: SETTINGS_TEXT.moveTo(STATUS_GROUP_LABELS.complete),
      }),
    );
    const moved = savedStatus(actions).options;
    expect(names(moved)).toEqual(['Not started', 'In progress', 'Done', 'Waiting on parts']);
    expect(moved[3]).toMatchObject({ name: 'Waiting on parts', group: 'complete' });
    await settle();

    const menu = await openMenu('Done');
    expect(
      within(menu).getByRole('menuitem', { name: SETTINGS_TEXT.deleteOption }),
    ).not.toHaveAttribute('aria-disabled');
    fireEvent.click(within(menu).getByRole('menuitem', { name: SETTINGS_TEXT.setDefault }));
    expect(savedStatus(actions).defaultOptionId).toBe(STATUS.done);
    await settle();
    expect(screen.getByText(SETTINGS_TEXT.isDefault).closest('li')).toContainElement(
      field(SETTINGS_TEXT.renameOption('Done')),
    );
  });
});
