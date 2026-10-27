import type { Property, PropertyConfig } from '@carehub/databases';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { jobsProperties, PRIORITY, PROPS, STATUS, USERS } from '../fixtures';
import { CELL_TEXT, STATUS_GROUP_LABELS } from './messages';
import { CUSTOMERS, cellCtx, openEditor, pressOutside, prop } from './test-helpers';
import type { PersonChoice, RowChoice } from './types';

const jobs = jobsProperties();
function job(id: string): Property {
  const found = jobs.find((p) => p.id === id);
  if (!found) throw new Error(`No property ${id}`);
  return found;
}
const search = (name: string) => screen.getByRole('combobox', { name });
const option = (name: string) => screen.getByRole('option', { name });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const key = (el: HTMLElement, k: string, init: Record<string, unknown> = {}) =>
  fireEvent.keyDown(el, { key: k, ...init });

const tags = prop(
  {
    type: 'multi_select',
    options: [
      { id: 'opt-leak', name: 'Leak', color: 'blue' },
      { id: 'opt-urgent', name: 'Urgent', color: 'red' },
    ],
  },
  'Tags',
);

describe('Select', () => {
  it('lists the options with the current one ticked, and saves a click', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.priority), value: PRIORITY.high });
    expect(search('Priority')).toHaveFocus();
    expect(search('Priority')).toHaveAttribute('placeholder', CELL_TEXT.search);
    expect(option('High')).toHaveAttribute('aria-selected', 'true');
    expect(option('Low')).toHaveAttribute('aria-selected', 'false');
    fireEvent.click(option('Low'));
    expect(onCommit).toHaveBeenCalledWith(PRIORITY.low, { changed: true });
  });

  it('picks the first match of what is typed with Enter', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.priority), value: null });
    type(search('Priority'), 'med');
    expect(screen.queryByRole('option', { name: 'High' })).toBeNull();
    key(search('Priority'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(PRIORITY.medium, { changed: true });
  });

  it('starts searching with typed text', async () => {
    const { onCommit } = await openEditor({
      property: job(PROPS.priority),
      value: null,
      initialText: 'Lo',
    });
    expect(search('Priority')).toHaveValue('Lo');
    key(search('Priority'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(PRIORITY.low, { changed: true });
  });

  it('moves the highlight with the arrow keys', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.priority), value: null });
    const box = search('Priority');
    expect(box).not.toHaveAttribute('aria-activedescendant');
    key(box, 'ArrowDown');
    key(box, 'ArrowDown');
    expect(box).toHaveAttribute('aria-activedescendant', option('Medium').id);
    key(box, 'ArrowUp');
    key(box, 'ArrowUp');
    expect(box).toHaveAttribute('aria-activedescendant', option('Low').id);
    key(box, 'Enter');
    expect(onCommit).toHaveBeenCalledWith(PRIORITY.low, { changed: true });
  });

  it('saves the current choice with Enter, Tab or a press outside', async () => {
    const entered = await openEditor({ property: job(PROPS.priority), value: PRIORITY.high });
    key(search('Priority'), 'Enter');
    expect(entered.onCommit).toHaveBeenCalledWith(PRIORITY.high, { changed: false });
    entered.unmount();
    const tabbed = await openEditor({ property: job(PROPS.priority), value: PRIORITY.high });
    key(search('Priority'), 'Tab');
    expect(tabbed.onCommit).toHaveBeenCalledWith(PRIORITY.high, { changed: false, move: 'next' });
    tabbed.unmount();
    const outside = await openEditor({ property: job(PROPS.priority), value: PRIORITY.high });
    pressOutside();
    expect(outside.onCommit).toHaveBeenCalledWith(PRIORITY.high, { changed: false });
  });

  it('clears with the ✕ on the chosen option', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.priority), value: PRIORITY.high });
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.remove('High') }));
    key(search('Priority'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(null, { changed: true });
  });

  it('leaves without saving on Escape', async () => {
    const { onCommit, onCancel } = await openEditor({ property: job(PROPS.priority), value: null });
    key(search('Priority'), 'Escape');
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('creates an option in the next colour from a new name', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.priority), value: null });
    type(search('Priority'), 'Urgent');
    expect(option(`${CELL_TEXT.create} Urgent`)).toBeInTheDocument();
    key(search('Priority'), 'Enter');
    const [value, details] = onCommit.mock.calls[0] ?? [];
    expect(details).toEqual({
      changed: true,
      newOptions: [{ id: value, name: 'Urgent', color: 'brown' }],
    });
  });

  it('refuses option names with commas or over 100 characters', async () => {
    const { onCommit } = await openEditor({ property: job(PROPS.priority), value: null });
    type(search('Priority'), 'High, urgent');
    key(search('Priority'), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent("Option names can't contain commas.");
    type(search('Priority'), 'x'.repeat(101));
    expect(screen.queryByRole('alert')).toBeNull();
    key(search('Priority'), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Option names can be up to 100 characters.',
    );
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('only finds options for people who can’t add them', async () => {
    await openEditor({ property: job(PROPS.priority), value: null, canCreateOptions: false });
    type(search('Priority'), 'Urgent');
    expect(screen.queryByRole('option')).toBeNull();
    expect(screen.getByText(CELL_TEXT.noMatches)).toBeInTheDocument();
  });
});

describe('Status', () => {
  it('lists options under To-do, In progress and Complete', async () => {
    const { onCommit } = await openEditor({
      property: job(PROPS.status),
      value: STATUS.inProgress,
    });
    const todo = screen.getByRole('group', { name: STATUS_GROUP_LABELS.todo });
    expect(within(todo).getByRole('option', { name: 'Not started' })).toBeInTheDocument();
    const doing = screen.getByRole('group', { name: STATUS_GROUP_LABELS.in_progress });
    expect(within(doing).getByRole('option', { name: 'In progress' })).toBeInTheDocument();
    const complete = screen.getByRole('group', { name: STATUS_GROUP_LABELS.complete });
    fireEvent.click(within(complete).getByRole('option', { name: 'Done' }));
    expect(onCommit).toHaveBeenCalledWith(STATUS.done, { changed: true });
  });

  it('never creates a status from typed text', async () => {
    await openEditor({ property: job(PROPS.status), value: null });
    type(search('Status'), 'Blocked');
    expect(screen.getByText(CELL_TEXT.noMatches)).toBeInTheDocument();
  });
});

describe('Multi-select', () => {
  it('ticks several options and saves them with Enter', async () => {
    const { onCommit } = await openEditor({ property: tags, value: ['opt-leak'] });
    fireEvent.click(option('Urgent'));
    expect(onCommit).not.toHaveBeenCalled();
    expect(option('Urgent')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('listbox', { name: 'Tags' })).toHaveAttribute(
      'aria-multiselectable',
      'true',
    );
    key(search('Tags'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith(['opt-leak', 'opt-urgent'], { changed: true });
  });

  it('removes the last option with Backspace and others with ✕', async () => {
    const { onCommit } = await openEditor({ property: tags, value: ['opt-leak', 'opt-urgent'] });
    key(search('Tags'), 'Backspace');
    expect(screen.queryByRole('button', { name: CELL_TEXT.remove('Urgent') })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.remove('Leak') }));
    key(search('Tags'), 'Tab', { shiftKey: true });
    expect(onCommit).toHaveBeenCalledWith(null, { changed: true, move: 'previous' });
  });

  it('adds new options to the property when saving', async () => {
    const { onCommit } = await openEditor({ property: tags, value: ['opt-leak'] });
    type(search('Tags'), 'Drain');
    key(search('Tags'), 'Enter');
    expect(screen.getByRole('button', { name: CELL_TEXT.remove('Drain') })).toBeInTheDocument();
    key(search('Tags'), 'Enter');
    const [value, details] = onCommit.mock.calls[0] ?? [];
    expect(value).toHaveLength(2);
    expect(details.newOptions).toEqual([{ id: value[1], name: 'Drain', color: 'gray' }]);
  });
});

const people: PersonChoice[] = [
  { id: USERS.avery.id, name: USERS.avery.name, email: 'avery@bluepine.example' },
  { id: USERS.jordan.id, name: USERS.jordan.name, email: 'jordan@bluepine.example' },
];
const crew = prop({ type: 'person', single: false, notify: false }, 'Crew');

describe('Person', () => {
  it('finds people by email and saves one for "one person only"', async () => {
    const { onCommit } = await openEditor({
      property: job(PROPS.technician),
      value: [USERS.avery.id],
      people,
    });
    type(search('Technician'), 'jordan@');
    expect(screen.queryByRole('option', { name: 'Avery Lin' })).toBeNull();
    key(search('Technician'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith([USERS.jordan.id], { changed: true });
  });

  it('picks several people', async () => {
    const { onCommit } = await openEditor({ property: crew, value: null, people });
    fireEvent.click(option('Avery Lin'));
    fireEvent.click(option('Jordan Park'));
    key(search('Crew'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith([USERS.avery.id, USERS.jordan.id], { changed: true });
  });

  it('keeps removed members out of the list but shows them on the value', async () => {
    await openEditor({
      property: crew,
      value: [USERS.jordan.id],
      people,
      ctx: cellCtx({ isRemovedUser: (id) => id === USERS.jordan.id }),
    });
    expect(screen.queryByRole('option', { name: 'Jordan Park' })).toBeNull();
    expect(screen.getByText('Jordan Park (removed)')).toBeInTheDocument();
  });

  it('refuses two people when only one is allowed', async () => {
    const { onCommit } = await openEditor({
      property: job(PROPS.technician),
      value: [USERS.avery.id, USERS.jordan.id],
      people,
    });
    key(search('Technician'), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('This property allows one person only.');
    expect(onCommit).not.toHaveBeenCalled();
  });
});

const customers: RowChoice[] = [
  { id: CUSTOMERS.bluePine, title: 'Blue Pine Plumbing', icon: '🔧' },
  { id: CUSTOMERS.untitled, title: '' },
];
const findRows = (query: string) =>
  Promise.resolve(customers.filter((r) => r.title.toLowerCase().includes(query.toLowerCase())));
const relation = (single: boolean): PropertyConfig => ({
  type: 'relation',
  targetDatabaseId: 'db-customers',
  single,
  twoWayPropertyId: null,
});
const customer = prop(relation(true), 'Customer');
const linked = prop(relation(false), 'Customers');

describe('Relation', () => {
  it('lists rows of the other database and saves one', async () => {
    const searchRows = vi.fn(findRows);
    const { onCommit } = await openEditor({ property: customer, value: null, searchRows });
    expect(searchRows).toHaveBeenCalledWith('');
    const row = await screen.findByRole('option', { name: 'Blue Pine Plumbing' });
    expect(option(CELL_TEXT.untitled)).toBeInTheDocument();
    fireEvent.click(row);
    expect(onCommit).toHaveBeenCalledWith([CUSTOMERS.bluePine], { changed: true });
  });

  it('shows Loading while it searches, then searches what is typed', async () => {
    let answer: (rows: readonly RowChoice[]) => void = () => {};
    const searchRows = vi.fn<(query: string) => Promise<readonly RowChoice[]>>(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    await openEditor({ property: linked, value: null, searchRows });
    expect(screen.getByRole('status')).toHaveTextContent(CELL_TEXT.loading);
    type(search('Customers'), 'blue');
    await waitFor(() => expect(searchRows).toHaveBeenLastCalledWith('blue'));
    answer(customers.slice(0, 1));
    expect(await screen.findByRole('option', { name: 'Blue Pine Plumbing' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('counts links to rows the viewer can’t open and keeps them', async () => {
    const { onCommit } = await openEditor({
      property: linked,
      value: [CUSTOMERS.hidden],
      hiddenLinks: 1,
      searchRows: findRows,
    });
    expect(screen.getByText("2 rows you can't open")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: 'Blue Pine Plumbing' }));
    key(search('Customers'), 'Backspace');
    key(search('Customers'), 'Backspace');
    fireEvent.click(option('Blue Pine Plumbing'));
    key(search('Customers'), 'Enter');
    expect(onCommit).toHaveBeenCalledWith([CUSTOMERS.hidden, CUSTOMERS.bluePine], {
      changed: true,
    });
  });

  it('adds a row with + New row', async () => {
    const onCreateRow = vi.fn((title: string) =>
      Promise.resolve({ id: 'row-supply', title } satisfies RowChoice),
    );
    const { onCommit } = await openEditor({
      property: customer,
      value: null,
      searchRows: findRows,
      onCreateRow,
    });
    type(search('Customer'), 'Blue Pine Supply');
    fireEvent.click(await screen.findByRole('option', { name: CELL_TEXT.newRow }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(['row-supply'], { changed: true }));
    expect(onCreateRow).toHaveBeenCalledWith('Blue Pine Supply');
  });

  it('says when the new row couldn’t be added', async () => {
    await openEditor({
      property: customer,
      value: null,
      searchRows: findRows,
      onCreateRow: () => Promise.reject(new Error('Offline')),
    });
    fireEvent.click(await screen.findByRole('option', { name: CELL_TEXT.newRow }));
    expect(await screen.findByRole('alert')).toHaveTextContent(CELL_TEXT.newRowFailed);
  });

  it('refuses two rows when only one is allowed', async () => {
    const { onCommit } = await openEditor({
      property: customer,
      value: [CUSTOMERS.bluePine, CUSTOMERS.untitled],
    });
    expect(screen.getByText(CELL_TEXT.noMatches)).toBeInTheDocument();
    key(search('Customer'), 'Enter');
    expect(screen.getByRole('alert')).toHaveTextContent('This relation allows one row only.');
    expect(onCommit).not.toHaveBeenCalled();
  });
});
