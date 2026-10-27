import { defaultConfig, type Id, type Property, type View } from '@carehub/databases';
import { DropdownMenuItem } from '@carehub/ui';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, jobsRows, PROPS, queryRow, VIEWS } from '../fixtures';
import { PROPERTY_TEXT } from './messages';
import type { PropertyActions } from './property-actions';
import { hideInView, placeInView } from './property-logic';
import { PropertyMenu, type PropertyMenuProps } from './property-menu';
import { cellCtx, pressOutside, prop, settle } from './test-helpers';

const db = jobsDatabase();
const rows = jobsRows().map(queryRow);
const tableView = db.views.find((v) => v.id === VIEWS.table);

function property(id: Id): Property {
  const found = db.properties.find((p) => p.id === id);
  if (!found) throw new Error(`no property ${id}`);
  return found;
}

const added = (name: string, config: Property['config'], id = 'prop-new'): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});

/** Writes that answer as the server would (the new property is "prop-new", a copy "prop-copy"). */
function fakeActions() {
  return {
    create: vi.fn<PropertyActions['create']>((input) =>
      Promise.resolve({ ...db, properties: [...db.properties, added(input.name, input.config)] }),
    ),
    update: vi.fn<PropertyActions['update']>((_id, change) =>
      Promise.resolve({ ...db, cleared: change.config ? 1 : undefined }),
    ),
    remove: vi.fn<PropertyActions['remove']>(() => Promise.resolve(db)),
    restore: vi.fn<PropertyActions['restore']>(() => Promise.resolve(db)),
    duplicate: vi.fn<PropertyActions['duplicate']>((id) =>
      Promise.resolve({
        ...db,
        properties: [...db.properties, { ...property(id), id: 'prop-copy', name: 'Cost 2' }],
      }),
    ),
  };
}

function renderMenu(id: Id = PROPS.cost, overrides: Partial<PropertyMenuProps> = {}) {
  const shown = overrides.property ?? property(id);
  const actions = fakeActions();
  const updateView = vi.fn<(patch: Partial<View>) => Promise<void>>(() => Promise.resolve());
  const onChanged = vi.fn();
  const onError = vi.fn();
  render(
    <PropertyMenu
      meta={db}
      property={shown}
      actions={actions}
      view={tableView}
      updateView={updateView}
      rows={rows}
      ctx={cellCtx()}
      onChanged={onChanged}
      onError={onError}
      {...overrides}
    >
      <button type="button">{shown.name}</button>
    </PropertyMenu>,
  );
  const trigger = screen.getByRole('button', { name: shown.name });
  return { property: shown, actions, updateView, onChanged, onError, trigger };
}

async function openMenu(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  await settle();
  return screen.getByRole('menu');
}

const item = (name: string | RegExp) => screen.getByRole('menuitem', { name });
const itemTexts = () => screen.getAllByRole('menuitem').map((el) => el.textContent);
const nameField = () => screen.getByRole('textbox', { name: PROPERTY_TEXT.propertyName });

async function choose(name: string | RegExp) {
  fireEvent.click(item(name));
  await settle();
}

function pressKey(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

describe('PropertyMenu: renaming', () => {
  it('opens on the name and saves a new one when it closes', async () => {
    const { actions, onChanged, trigger, property: cost } = renderMenu();
    await openMenu(trigger);
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveValue('Cost');

    fireEvent.change(nameField(), { target: { value: '  Price ' } });
    pressKey('Enter');
    await settle();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { name: 'Price' });
    expect(onChanged).toHaveBeenCalledWith({ kind: 'renamed', property: cost, name: 'Price' });
    expect(trigger).toHaveFocus();
  });

  it('says why a name will not do and stays open', async () => {
    const { actions, trigger } = renderMenu();
    await openMenu(trigger);

    fireEvent.change(nameField(), { target: { value: 'notes' } });
    pressKey('Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('A property named "notes" already exists.');
    expect(nameField()).toHaveAttribute('aria-invalid', 'true');

    fireEvent.change(nameField(), { target: { value: ' ' } });
    expect(screen.queryByRole('alert')).toBeNull();
    pressKey('Enter');
    expect(screen.getByRole('alert')).toHaveTextContent(PROPERTY_TEXT.nameEmpty);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(actions.update).not.toHaveBeenCalled();
  });

  it('leaves without saving on Escape', async () => {
    const { actions, trigger } = renderMenu();
    await openMenu(trigger);
    fireEvent.change(nameField(), { target: { value: 'Price' } });
    pressKey('Escape');
    await settle();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(actions.update).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('saves on a press outside, and not when nothing changed', async () => {
    const { actions, trigger } = renderMenu();
    await openMenu(trigger);
    pressOutside();
    await settle();
    expect(actions.update).not.toHaveBeenCalled();

    await openMenu(trigger);
    fireEvent.change(nameField(), { target: { value: 'Price' } });
    pressOutside();
    await settle();
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { name: 'Price' });
  });

  it('goes from the name to the first item with the down arrow', async () => {
    const { trigger } = renderMenu();
    await openMenu(trigger);
    pressKey('ArrowDown');
    expect(item(/^Change type/)).toHaveFocus();
  });

  it('reports a rename the server refused', async () => {
    const { actions, onError, onChanged, trigger } = renderMenu();
    const refused = new Error('Refused');
    actions.update.mockRejectedValue(refused);
    await openMenu(trigger);
    fireEvent.change(nameField(), { target: { value: 'Price' } });
    pressKey('Enter');
    await settle();
    expect(onError).toHaveBeenCalledWith(refused);
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('PropertyMenu: the items each property gets', () => {
  it('offers everything for Cost, in order', async () => {
    const { trigger } = renderMenu(PROPS.cost, {
      onEditProperty: vi.fn(),
      onPropertyAccess: vi.fn(),
    });
    await openMenu(trigger);
    expect(itemTexts()).toEqual([
      'Change type Number',
      PROPERTY_TEXT.editProperty,
      PROPERTY_TEXT.hide,
      PROPERTY_TEXT.insertLeft,
      PROPERTY_TEXT.insertRight,
      PROPERTY_TEXT.duplicate,
      PROPERTY_TEXT.propertyAccess,
      PROPERTY_TEXT.delete,
    ]);
  });

  it('lets Name be renamed but not changed, hidden, duplicated or deleted', async () => {
    const { trigger } = renderMenu(PROPS.name, { onPropertyAccess: vi.fn() });
    await openMenu(trigger);
    expect(nameField()).toHaveValue('Name');
    expect(itemTexts()).toEqual([PROPERTY_TEXT.insertRight]);
  });

  it('adds the layout items between the type and the column items', async () => {
    const { trigger } = renderMenu(PROPS.cost, {
      viewItems: <DropdownMenuItem>Sort ascending</DropdownMenuItem>,
    });
    await openMenu(trigger);
    expect(itemTexts().slice(0, 3)).toEqual([
      'Change type Number',
      'Sort ascending',
      'Hide in this view',
    ]);
  });

  it('leaves out Hide and Insert without a view to change', async () => {
    const { trigger } = renderMenu(PROPS.cost, { view: undefined });
    await openMenu(trigger);
    expect(itemTexts()).toEqual([
      'Change type Number',
      PROPERTY_TEXT.duplicate,
      PROPERTY_TEXT.delete,
    ]);
  });

  async function readOnlyMenu(meta: PropertyMenuProps['meta']) {
    const { trigger } = renderMenu(PROPS.cost, {
      meta,
      viewItems: <DropdownMenuItem>Sort ascending</DropdownMenuItem>,
      onPropertyAccess: vi.fn(),
      onEditProperty: vi.fn(),
    });
    const menu = await openMenu(trigger);
    expect(within(menu).queryByRole('textbox')).toBeNull();
    expect(within(menu).getByText('Cost')).toBeInTheDocument();
  }

  it('shows Can view the name and the layout items only', async () => {
    await readOnlyMenu({ ...db, viewerAccess: 'view' });
    expect(itemTexts()).toEqual(['Sort ascending']);
  });

  it('keeps the structure as it is while Lock structure is on', async () => {
    await readOnlyMenu({ ...db, locked: true });
    expect(itemTexts()).toEqual(['Sort ascending', PROPERTY_TEXT.propertyAccess]);
  });

  it('opens property access and the settings once the menu has closed', async () => {
    const onPropertyAccess = vi.fn();
    const onEditProperty = vi.fn();
    const { trigger } = renderMenu(PROPS.cost, { onPropertyAccess, onEditProperty });
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.propertyAccess);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onPropertyAccess).toHaveBeenCalledTimes(1);

    await openMenu(trigger);
    await choose(PROPERTY_TEXT.editProperty);
    expect(onEditProperty).toHaveBeenCalledTimes(1);
  });

  it('offers property access with Full access only', async () => {
    const { trigger } = renderMenu(PROPS.cost, {
      meta: { ...db, viewerAccess: 'edit' },
      onPropertyAccess: vi.fn(),
    });
    await openMenu(trigger);
    expect(screen.queryByRole('menuitem', { name: PROPERTY_TEXT.propertyAccess })).toBeNull();
  });
});

describe('PropertyMenu: changing the type', () => {
  it('lists the types Status can change into, starting on the first', async () => {
    const { trigger } = renderMenu(PROPS.status);
    await openMenu(trigger);
    await choose(/^Change type/);
    expect(itemTexts()).toEqual([PROPERTY_TEXT.back, 'Text', 'Select', 'Multi-select']);
    expect(item('Text')).toHaveFocus();
  });

  it('changes straight away when no value is cleared', async () => {
    const { actions, onChanged, trigger, property: cost } = renderMenu(PROPS.cost);
    actions.update.mockResolvedValue({ ...db, cleared: 0 });
    await openMenu(trigger);
    await choose(/^Change type/);
    await choose('Text');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { config: { type: 'text' } });
    expect(onChanged).toHaveBeenCalledWith({
      kind: 'type_changed',
      property: cost,
      to: 'text',
      cleared: 0,
    });
  });

  it('asks first when values would be cleared, saying how many', async () => {
    const { actions, onChanged, trigger, property: notes } = renderMenu(PROPS.notes);
    await openMenu(trigger);
    await choose(/^Change type/);
    await choose('Number');

    const dialog = screen.getByRole('dialog', { name: 'Change "Notes" to Number?' });
    expect(dialog).toHaveAccessibleDescription('Values in 1 row will be cleared.');
    expect(actions.update).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: PROPERTY_TEXT.changeType }));
    await settle();
    expect(actions.update).toHaveBeenCalledWith(PROPS.notes, { config: defaultConfig('number') });
    expect(onChanged).toHaveBeenCalledWith({
      kind: 'type_changed',
      property: notes,
      to: 'number',
      cleared: 1,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('keeps the type on Cancel', async () => {
    const { actions, trigger } = renderMenu(PROPS.notes);
    await openMenu(trigger);
    await choose(/^Change type/);
    await choose('Checkbox');
    const dialog = screen.getByRole('dialog', { name: 'Change "Notes" to Checkbox?' });
    expect(within(dialog).getByRole('button', { name: PROPERTY_TEXT.cancel })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: PROPERTY_TEXT.cancel }));
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(actions.update).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('goes back to the menu with Back or Escape', async () => {
    const { trigger } = renderMenu(PROPS.notes);
    await openMenu(trigger);
    await choose(/^Change type/);
    await choose(PROPERTY_TEXT.back);
    expect(nameField()).toHaveFocus();

    await choose(/^Change type/);
    pressKey('Escape');
    await settle();
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(nameField()).toHaveFocus();
    pressKey('Escape');
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('PropertyMenu: the view and its columns', () => {
  const columns = tableView?.properties ?? [];

  it('hides the property in this view', async () => {
    const { updateView, onChanged, trigger, property: cost } = renderMenu();
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.hide);
    expect(updateView).toHaveBeenCalledWith({ properties: hideInView(columns, PROPS.cost) });
    expect(onChanged).toHaveBeenCalledWith({ kind: 'hidden', property: cost });
  });

  it('inserts a property with the typed name on the right', async () => {
    const { actions, updateView, onChanged, trigger } = renderMenu();
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.insertRight);
    expect(nameField()).toHaveFocus();
    expect(nameField()).toHaveValue('');
    fireEvent.change(nameField(), { target: { value: 'Invoice' } });
    await choose('Number');

    expect(actions.create).toHaveBeenCalledWith({
      name: 'Invoice',
      config: defaultConfig('number'),
    });
    expect(updateView).toHaveBeenCalledWith({
      properties: placeInView(columns, PROPS.cost, 'prop-new', 'right'),
    });
    expect(onChanged).toHaveBeenCalledWith({
      kind: 'inserted',
      property: added('Invoice', defaultConfig('number')),
      side: 'right',
    });
  });

  it('adds Text on Enter, on the left', async () => {
    const { actions, updateView, trigger } = renderMenu();
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.insertLeft);
    fireEvent.change(nameField(), { target: { value: 'Invoice' } });
    pressKey('Enter');
    await settle();

    expect(screen.queryByRole('menu')).toBeNull();
    expect(actions.create).toHaveBeenCalledWith({ name: 'Invoice', config: { type: 'text' } });
    expect(updateView).toHaveBeenCalledWith({
      properties: placeInView(columns, PROPS.cost, 'prop-new', 'left'),
    });
  });

  it('names an untitled property after its type', async () => {
    const { actions, trigger } = renderMenu(PROPS.name);
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.insertRight);
    fireEvent.click(item('Status'));
    await settle();
    expect(actions.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Status 2' }));
  });

  it('refuses a name that is taken and stays on the list', async () => {
    const { actions, trigger } = renderMenu();
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.insertRight);
    fireEvent.change(nameField(), { target: { value: 'due date' } });
    await choose('Date');

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A property named "due date" already exists.',
    );
    expect(nameField()).toHaveFocus();
    expect(actions.create).not.toHaveBeenCalled();
  });

  it('duplicates the property and shows the copy beside it', async () => {
    const { actions, updateView, onChanged, trigger, property: cost } = renderMenu();
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.duplicate);
    expect(actions.duplicate).toHaveBeenCalledWith(PROPS.cost);
    expect(updateView).toHaveBeenCalledWith({
      properties: placeInView(columns, PROPS.cost, 'prop-copy', 'right'),
    });
    expect(onChanged).toHaveBeenCalledWith({
      kind: 'duplicated',
      property: cost,
      copy: { ...cost, id: 'prop-copy', name: 'Cost 2' },
    });
  });
});

describe('PropertyMenu: deleting', () => {
  it('asks first, says how many values go, and deletes', async () => {
    const { actions, onChanged, trigger, property: cost } = renderMenu();
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.delete);

    const dialog = screen.getByRole('dialog', { name: 'Delete "Cost"?' });
    expect(dialog).toHaveAccessibleDescription(
      `Values in 3 rows will be removed. ${PROPERTY_TEXT.restoreLater}`,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: PROPERTY_TEXT.delete }));
    await settle();
    expect(actions.remove).toHaveBeenCalledWith(PROPS.cost);
    expect(onChanged).toHaveBeenCalledWith({ kind: 'deleted', property: cost });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('names the other side of a two-way relation', async () => {
    const customer = prop(
      {
        type: 'relation',
        targetDatabaseId: 'db-customers',
        single: true,
        twoWayPropertyId: 'p-jobs',
      },
      'Customer',
    );
    const meta = { ...db, properties: [...db.properties, customer] };
    const { trigger } = renderMenu(PROPS.cost, {
      meta,
      property: customer,
      twoWay: { propertyName: 'Jobs', databaseTitle: 'Customers' },
    });
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.delete);
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      `This also deletes "Jobs" in Customers. ${PROPERTY_TEXT.restoreLater}`,
    );
  });

  it('keeps the confirm open when the delete is refused', async () => {
    const { actions, onError, onChanged, trigger } = renderMenu();
    const refused = new Error('Refused');
    actions.remove.mockRejectedValue(refused);
    await openMenu(trigger);
    await choose(PROPERTY_TEXT.delete);
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: PROPERTY_TEXT.delete }));
    await settle();
    expect(onError).toHaveBeenCalledWith(refused);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
