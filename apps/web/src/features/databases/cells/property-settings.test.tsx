import type { Id, Property } from '@carehub/databases';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { jobsDatabase, PROPS } from '../fixtures';
import { PROPERTY_TEXT, SETTINGS_TEXT } from './messages';
import type { PropertyActions } from './property-actions';
import { PropertyMenu } from './property-menu';
import { PropertySettings, type PropertySettingsProps } from './property-settings';
import { cellCtx, pressOutside, settle } from './test-helpers';

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
  render(
    <PropertySettings
      meta={db}
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

describe('PropertySettings from the property menu', () => {
  async function openSettings(outside?: ReactNode) {
    const actions = fakeActions();
    render(
      <>
        <PropertyMenu meta={db} property={property(PROPS.cost)} actions={actions} ctx={cellCtx()}>
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
});
