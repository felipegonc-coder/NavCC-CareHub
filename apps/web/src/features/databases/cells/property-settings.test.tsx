import type { Id, Property } from '@carehub/databases';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS } from '../fixtures';
import { PROPERTY_TEXT, SETTINGS_TEXT } from './messages';
import type { PropertyActions } from './property-actions';
import { PropertyMenu, type PropertyMenuProps } from './property-menu';
import { PropertySettings, type PropertySettingsProps } from './property-settings';
import { cellCtx, pressOutside, prop, settle } from './test-helpers';

const db = jobsDatabase();

function property(id: Id): Property {
  const found = db.properties.find((p) => p.id === id);
  if (!found) throw new Error(`no property ${id}`);
  return found;
}

function fakeActions() {
  return {
    create: vi.fn<PropertyActions['create']>(() => Promise.resolve(db)),
    update: vi.fn<PropertyActions['update']>(() => Promise.resolve(db)),
    remove: vi.fn<PropertyActions['remove']>(() => Promise.resolve(db)),
    restore: vi.fn<PropertyActions['restore']>(() => Promise.resolve(db)),
    duplicate: vi.fn<PropertyActions['duplicate']>(() => Promise.resolve(db)),
  };
}

function renderSettings(shown: Property, overrides: Partial<PropertySettingsProps> = {}) {
  const actions = fakeActions();
  const onError = vi.fn();
  const known = db.properties.some((p) => p.id === shown.id);
  render(
    <PropertySettings
      meta={{ ...db, properties: known ? db.properties : [...db.properties, shown] }}
      property={shown}
      actions={actions}
      onError={onError}
      {...overrides}
    />,
  );
  return { actions, onError };
}

const field = (name: string) => screen.getByRole('textbox', { name });
const picker = (name: string) => screen.getByRole('combobox', { name });
const toggle = (name: string) => screen.getByRole('switch', { name });

function pick(name: string, value: string) {
  fireEvent.change(picker(name), { target: { value } });
}

function type(name: string, text: string) {
  fireEvent.change(field(name), { target: { value: text } });
  fireEvent.keyDown(field(name), { key: 'Enter' });
}

describe('PropertySettings: what every property has', () => {
  it('is titled Edit property and renames on Enter', () => {
    const { actions } = renderSettings(property(PROPS.cost));
    expect(screen.getByRole('heading', { name: SETTINGS_TEXT.title })).toBeInTheDocument();
    expect(field(PROPERTY_TEXT.propertyName)).toHaveValue('Cost');

    type(PROPERTY_TEXT.propertyName, '  Price ');
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { name: 'Price' });
    expect(field(PROPERTY_TEXT.propertyName)).toHaveValue('Price');
  });

  it('says why a name will not do', () => {
    const { actions } = renderSettings(property(PROPS.cost));
    type(PROPERTY_TEXT.propertyName, 'notes');
    expect(screen.getByText('A property named "notes" already exists.')).toBeInTheDocument();
    expect(field(PROPERTY_TEXT.propertyName)).toHaveAttribute('aria-invalid', 'true');
    expect(actions.update).not.toHaveBeenCalled();
  });

  it('saves the description when the field is left', () => {
    const { actions } = renderSettings(property(PROPS.cost));
    fireEvent.change(field(SETTINGS_TEXT.description), {
      target: { value: 'What the job cost. ' },
    });
    fireEvent.blur(field(SETTINGS_TEXT.description));
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { description: 'What the job cost.' });
  });

  it('shows the type', () => {
    renderSettings(property(PROPS.cost));
    expect(screen.getByText(SETTINGS_TEXT.type).closest('p')).toHaveTextContent(/Type\s*Number/);
  });

  it('sets how it shows on row pages', () => {
    const { actions } = renderSettings(property(PROPS.cost));
    expect(
      Array.from(picker(SETTINGS_TEXT.rowPage).querySelectorAll('option'), (o) => o.textContent),
    ).toEqual(['Always show', 'Hide when empty', 'Always hide']);
    pick(SETTINGS_TEXT.rowPage, 'hide_when_empty');
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { rowPage: 'hide_when_empty' });
  });

  it('leaves row pages out for Name', () => {
    renderSettings(property(PROPS.name));
    expect(screen.queryByRole('combobox', { name: SETTINGS_TEXT.rowPage })).toBeNull();
  });

  it('can only be looked at without Can edit', () => {
    renderSettings(property(PROPS.cost), { meta: { ...db, viewerAccess: 'view' } });
    expect(field(PROPERTY_TEXT.propertyName)).toBeDisabled();
    expect(field(SETTINGS_TEXT.description)).toBeDisabled();
    expect(picker(SETTINGS_TEXT.rowPage)).toBeDisabled();
  });

  it('shows the saved settings again when the server refuses a change', async () => {
    const { actions, onError } = renderSettings(property(PROPS.cost));
    const refused = new Error('Refused');
    actions.update.mockRejectedValue(refused);
    pick(SETTINGS_TEXT.rowPage, 'always_hide');
    expect(picker(SETTINGS_TEXT.rowPage)).toHaveValue('always_hide');
    await settle();
    expect(onError).toHaveBeenCalledWith(refused);
    expect(picker(SETTINGS_TEXT.rowPage)).toHaveValue('always');
  });

  it('keeps showing a saved change until the answer replaces the property', () => {
    const { actions } = renderSettings(property(PROPS.cost));
    pick(SETTINGS_TEXT.rowPage, 'hide_when_empty');
    type(PROPERTY_TEXT.propertyName, 'Price');
    expect(actions.update).toHaveBeenCalledTimes(2);
    expect(picker(SETTINGS_TEXT.rowPage)).toHaveValue('hide_when_empty');
    expect(field(PROPERTY_TEXT.propertyName)).toHaveValue('Price');
  });
});

describe('PropertySettings: Number', () => {
  const cost = property(PROPS.cost);

  it('changes the format and decimals', () => {
    const { actions } = renderSettings(cost);
    expect(picker(SETTINGS_TEXT.numberFormat)).toHaveValue('currency:USD');
    pick(SETTINGS_TEXT.numberFormat, 'currency:EUR');
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.cost, {
      config: { ...cost.config, currency: 'EUR' },
    });

    expect(picker(SETTINGS_TEXT.decimals)).toHaveValue('2');
    pick(SETTINGS_TEXT.decimals, 'auto');
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.cost, {
      config: { ...cost.config, currency: 'EUR', decimals: 'auto' },
    });
  });

  it('shows a bar or ring with divide by, color and show number', () => {
    const { actions } = renderSettings(cost);
    expect(screen.queryByRole('textbox', { name: SETTINGS_TEXT.divideBy })).toBeNull();
    pick(SETTINGS_TEXT.showAs, 'bar');
    const bar = { ...cost.config, showAs: 'bar', divideBy: 100 };
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.cost, { config: bar });
    expect(field(SETTINGS_TEXT.divideBy)).toHaveValue('100');

    type(SETTINGS_TEXT.divideBy, '0');
    expect(screen.getByText('Enter a number above 0.')).toBeInTheDocument();
    type(SETTINGS_TEXT.divideBy, '5000');
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.cost, {
      config: { ...bar, divideBy: 5000 },
    });

    pick(SETTINGS_TEXT.color, 'green');
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.cost, {
      config: { ...bar, divideBy: 5000, color: 'green' },
    });
    expect(toggle(SETTINGS_TEXT.showNumber)).toBeChecked();
    fireEvent.click(toggle(SETTINGS_TEXT.showNumber));
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.cost, {
      config: { ...bar, divideBy: 5000, color: 'green', showNumber: false },
    });
  });
});

describe('PropertySettings: dates, people and IDs', () => {
  it('sets the date and time format', () => {
    const due = property(PROPS.due);
    const { actions } = renderSettings(due);
    pick(SETTINGS_TEXT.dateFormat, 'ymd');
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.due, {
      config: { ...due.config, format: 'ymd' },
    });
    pick(SETTINGS_TEXT.timeFormat, '24h');
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.due, {
      config: { ...due.config, format: 'ymd', timeFormat: '24h' },
    });
  });

  it('gives created and edited times the same formats', () => {
    renderSettings(prop({ type: 'created_time', format: 'full', timeFormat: 'viewer' }));
    expect(picker(SETTINGS_TEXT.dateFormat)).toHaveValue('full');
    expect(picker(SETTINGS_TEXT.timeFormat)).toHaveValue('viewer');
  });

  it('sets one person only and notify', () => {
    const technician = property(PROPS.technician);
    const { actions } = renderSettings(technician);
    expect(toggle(SETTINGS_TEXT.onePerson)).toBeChecked();
    fireEvent.click(toggle(SETTINGS_TEXT.onePerson));
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.technician, {
      config: { type: 'person', single: false, notify: false },
    });
    expect(toggle(SETTINGS_TEXT.notify)).not.toBeChecked();
    fireEvent.click(toggle(SETTINGS_TEXT.notify));
    expect(actions.update).toHaveBeenLastCalledWith(PROPS.technician, {
      config: { type: 'person', single: false, notify: true },
    });
  });

  it('sets an ID prefix, with an example', () => {
    const jobId = prop({ type: 'unique_id', prefix: null }, 'Job ID');
    const { actions } = renderSettings(jobId);
    expect(field(SETTINGS_TEXT.prefix)).toHaveValue('');
    expect(screen.getByText('Rows are numbered 17.')).toBeInTheDocument();

    fireEvent.change(field(SETTINGS_TEXT.prefix), { target: { value: 'QA-' } });
    expect(screen.getByText('Rows are numbered QA-17.')).toBeInTheDocument();
    fireEvent.keyDown(field(SETTINGS_TEXT.prefix), { key: 'Enter' });
    expect(actions.update).toHaveBeenCalledWith(jobId.id, {
      config: { type: 'unique_id', prefix: 'QA' },
    });
    expect(field(SETTINGS_TEXT.prefix)).toHaveValue('QA');

    type(SETTINGS_TEXT.prefix, 'Q A');
    expect(
      screen.getByText('Use up to 20 letters, numbers, hyphens or underscores.'),
    ).toBeInTheDocument();
    expect(actions.update).toHaveBeenCalledTimes(1);
  });
});

describe('PropertySettings: relations', () => {
  const customer = prop(
    { type: 'relation', targetDatabaseId: 'db-customers', single: false, twoWayPropertyId: null },
    'Customer',
  );
  const customers = [{ id: 'db-customers', title: 'Customers' }];

  it('names the related database and sets one row only and two-way', () => {
    const { actions } = renderSettings(customer, { databases: customers });
    expect(screen.getByText(SETTINGS_TEXT.relatedTo).closest('p')).toHaveTextContent(
      /Related to\s*Customers/,
    );
    fireEvent.click(toggle(SETTINGS_TEXT.oneRow));
    expect(actions.update).toHaveBeenLastCalledWith(customer.id, {
      config: { ...customer.config, single: true },
    });
    expect(screen.getByText(SETTINGS_TEXT.twoWayHint)).toBeInTheDocument();
    fireEvent.click(toggle(SETTINGS_TEXT.twoWay));
    expect(actions.update).toHaveBeenLastCalledWith(customer.id, {
      config: { ...customer.config, single: true, twoWayPropertyId: expect.any(String) },
    });
    expect(toggle(SETTINGS_TEXT.twoWay)).toBeChecked();
  });

  it("says when the related database can't be opened", () => {
    renderSettings(customer, { databases: [] });
    expect(screen.getByText(SETTINGS_TEXT.unknownDatabase)).toBeInTheDocument();
  });

  it('asks before turning two-way off, naming the other side', async () => {
    const twoWay = { ...customer, config: { ...customer.config, twoWayPropertyId: 'prop-jobs' } };
    const { actions } = renderSettings(twoWay, {
      databases: customers,
      twoWay: { propertyName: 'Jobs', databaseTitle: 'Customers' },
    });
    fireEvent.click(toggle(SETTINGS_TEXT.twoWay));
    await settle();
    const confirm = screen.getByRole('dialog', { name: SETTINGS_TEXT.stopTwoWayTitle });
    expect(confirm).toHaveAccessibleDescription('This deletes "Jobs" in Customers.');
    expect(actions.update).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.stopShowing }));
    await settle();
    expect(actions.update).toHaveBeenCalledWith(twoWay.id, {
      config: { ...twoWay.config, twoWayPropertyId: null },
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the confirm open when the server refuses', async () => {
    const twoWay = { ...customer, config: { ...customer.config, twoWayPropertyId: 'prop-jobs' } };
    const { actions, onError } = renderSettings(twoWay, { databases: customers });
    const refused = new Error('Refused');
    actions.update.mockRejectedValue(refused);
    fireEvent.click(toggle(SETTINGS_TEXT.twoWay));
    await settle();
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(SETTINGS_TEXT.stopTwoWayUnnamed);
    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.stopShowing }));
    await settle();
    expect(onError).toHaveBeenCalledWith(refused);
    expect(screen.getByRole('dialog', { name: SETTINGS_TEXT.stopTwoWayTitle })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: PROPERTY_TEXT.cancel }));
    await settle();
    expect(toggle(SETTINGS_TEXT.twoWay)).toBeChecked();
  });
});

describe('PropertySettings from the property menu', () => {
  async function openSettings(outside?: ReactNode, more: Partial<PropertyMenuProps> = {}) {
    const actions = fakeActions();
    render(
      <>
        <PropertyMenu
          meta={db}
          property={property(PROPS.cost)}
          actions={actions}
          ctx={cellCtx()}
          {...more}
        >
          <button type="button">Cost</button>
        </PropertyMenu>
        {outside}
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Cost' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: PROPERTY_TEXT.editProperty }));
    await settle();
    await settle();
    return { actions, trigger };
  }

  it('opens by the header with the name ready, and saves it on a press outside', async () => {
    const { actions, trigger } = await openSettings();
    expect(screen.getByRole('dialog', { name: SETTINGS_TEXT.title })).toBeInTheDocument();
    expect(field(PROPERTY_TEXT.propertyName)).toHaveFocus();

    fireEvent.change(field(PROPERTY_TEXT.propertyName), { target: { value: 'Price' } });
    pressOutside();
    await settle();
    expect(screen.queryByRole('dialog', { name: SETTINGS_TEXT.title })).toBeNull();
    expect(actions.update).toHaveBeenCalledTimes(1);
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { name: 'Price' });
    expect(trigger).toHaveFocus();
  });

  it('leaves focus in a field outside that took it, and saves the name once', async () => {
    const { actions } = await openSettings(<input aria-label="Search" />);
    fireEvent.change(field(PROPERTY_TEXT.propertyName), { target: { value: 'Price' } });
    const search = field('Search');
    act(() => search.focus());
    await settle();
    expect(screen.queryByRole('dialog', { name: SETTINGS_TEXT.title })).toBeNull();
    expect(search).toHaveFocus();
    expect(actions.update).toHaveBeenCalledTimes(1);
    expect(actions.update).toHaveBeenCalledWith(PROPS.cost, { name: 'Price' });
  });

  it('drops what was typed when it closes with Escape', async () => {
    const { actions, trigger } = await openSettings();
    fireEvent.change(field(PROPERTY_TEXT.propertyName), { target: { value: 'Price' } });
    fireEvent.keyDown(field(PROPERTY_TEXT.propertyName), { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog', { name: SETTINGS_TEXT.title })).toBeNull();
    expect(actions.update).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it('stays open through the two-way confirm', async () => {
    const linked = prop(
      { type: 'relation', targetDatabaseId: 'db-customers', single: false, twoWayPropertyId: 'p2' },
      'Customer',
    );
    const { actions } = await openSettings(null, {
      meta: { ...db, properties: [...db.properties, linked] },
      property: linked,
      databases: [{ id: 'db-customers', title: 'Customers' }],
      twoWay: { propertyName: 'Jobs', databaseTitle: 'Customers' },
    });
    fireEvent.click(toggle(SETTINGS_TEXT.twoWay));
    await settle();
    expect(
      screen.getByRole('dialog', { name: SETTINGS_TEXT.stopTwoWayTitle }),
    ).toHaveAccessibleDescription('This deletes "Jobs" in Customers.');

    fireEvent.click(screen.getByRole('button', { name: SETTINGS_TEXT.stopShowing }));
    await settle();
    expect(actions.update).toHaveBeenCalledWith(linked.id, {
      config: { ...linked.config, twoWayPropertyId: null },
    });
    expect(screen.queryByRole('dialog', { name: SETTINGS_TEXT.stopTwoWayTitle })).toBeNull();
    expect(screen.getByRole('dialog', { name: SETTINGS_TEXT.title })).toBeInTheDocument();
  });
});
