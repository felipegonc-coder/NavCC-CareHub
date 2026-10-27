import { useSyncExternalStore } from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultConfig,
  defaultView,
  type FormDefinition,
  type Property,
  type RichText,
  type Viewer,
} from '@carehub/databases';
import { ApiError, type DatabaseWithVersion } from '../databases/api';
import {
  JOBS_ID,
  PRIORITY,
  PROPS,
  USERS,
  jobsDatabase,
  mockActions,
  mockClient,
  renderWithDatabase,
  testViewer,
  viewData,
} from '../databases/test-utils';
import { FormsClientProvider } from './api';
import FormLayout from './layout';
import { writeSelection } from './rich-dom';
import { mockFormsClient, question, stubResizeObserver } from './test-utils';

const FORM_VIEW = 'view-form';

/** Notes shows only when Priority is High. */
const notesWhenHigh = question(PROPS.notes, 'Notes', {
  logic: {
    combinator: 'and',
    conditions: [
      {
        id: 'cond-high',
        questionPropertyId: PROPS.priority,
        op: 'is_any_of',
        value: [PRIORITY.high],
      },
    ],
  },
});

const threeQuestions = [
  question(PROPS.name, 'Name'),
  question(PROPS.priority, 'Priority'),
  notesWhenHigh,
];

/** The Jobs database with a Form view (link code abc123). */
function formDatabase(
  form: Partial<FormDefinition> = {},
  overrides: Partial<DatabaseWithVersion> = {},
): DatabaseWithVersion {
  const base = jobsDatabase(overrides);
  const view = defaultView('form', base.properties, { databaseTitle: base.title });
  if (!view.form) throw new Error('A Form view starts with a form.');
  const formView = { ...view, id: FORM_VIEW, form: { ...view.form, linkCode: 'abc123', ...form } };
  return { ...base, views: [...base.views, formView] };
}

/**
 * Renders the Form view the way the database shell does: saved view changes and new properties
 * come back as new props.
 */
function renderFormView(meta: DatabaseWithVersion = formDatabase(), viewer: Viewer = testViewer()) {
  let current = meta;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const update = (next: DatabaseWithVersion) => {
    current = next;
    listeners.forEach((listener) => listener());
  };

  const actions = mockActions();
  actions.updateView.mockImplementation(async (change) => {
    update({
      ...current,
      views: current.views.map((v) => (v.id === FORM_VIEW ? { ...v, ...change } : v)),
    });
  });
  const client = mockClient();
  client.createProperty.mockImplementation(async (_databaseId, property) => {
    const created: Property = {
      id: 'prop-new',
      name: property.name,
      description: '',
      config: property.config,
      rowPage: 'always',
    };
    const next = { ...current, properties: [...current.properties, created] };
    update(next);
    return next;
  });
  const forms = mockFormsClient();

  function Harness() {
    const db = useSyncExternalStore(subscribe, () => current);
    const view = db.views.find((v) => v.id === FORM_VIEW);
    if (!view) throw new Error('The database has no Form view.');
    return (
      <FormLayout
        meta={db}
        view={view}
        data={viewData()}
        viewer={viewer}
        actions={actions}
        readOnly={false}
      />
    );
  }

  const rendered = renderWithDatabase(
    <FormsClientProvider client={forms}>
      <Harness />
    </FormsClientProvider>,
    { client },
  );

  /** The form the last save sent. */
  function saved(): FormDefinition {
    const form = actions.updateView.mock.lastCall?.[0].form;
    if (!form) throw new Error('Nothing was saved.');
    return form;
  }
  return { ...rendered, actions, forms, saved };
}

const order = (def: FormDefinition) => def.questions.map((q) => q.propertyId);
const card = (name: string) => screen.getByRole('group', { name });

function choose(trigger: HTMLElement, item: string) {
  fireEvent.keyDown(trigger, { key: 'Enter' });
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

/** Lays the cards out 200 px apart, as the page would: their middles are at 90, 290 and 490. */
function layOutCards() {
  document.querySelectorAll<HTMLElement>('[data-question-index]').forEach((item) => {
    const top = Number(item.dataset.questionIndex) * 200;
    item.getBoundingClientRect = () =>
      ({
        top,
        bottom: top + 180,
        height: 180,
        left: 0,
        right: 600,
        width: 600,
        x: 0,
        y: top,
      }) as DOMRect;
  });
}

/** A pointer event at height `y`, sent as a MouseEvent (all that's needed of a PointerEvent). */
const pointer = (target: Element, type: string, clientY: number) =>
  fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, clientY }));

const handle = (name: string) => within(card(name)).getByTestId('form-question-handle');

function openSettings() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  return screen.getByRole('complementary', { name: 'Settings' });
}

function openShare() {
  fireEvent.click(screen.getByRole('button', { name: 'Share form' }));
  return screen.getByRole('dialog', { name: 'Share form' });
}

beforeEach(() => {
  stubResizeObserver();
});

describe('Form view builder', () => {
  it('shows the builder to people who can edit the form', () => {
    renderFormView();
    expect(screen.getByLabelText('Form title')).toHaveValue('Jobs');
    expect(within(card('Name')).getByLabelText('Question')).toHaveValue('Name');
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share form' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('offers the properties without a question in "+ Add question"', async () => {
    const { saved } = renderFormView();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add question' }), { key: 'Enter' });
    expect(screen.queryByRole('menuitem', { name: 'Name' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Status' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'New question' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Priority' }));
    expect(order(saved())).toEqual([PROPS.name, PROPS.priority]);
    const priority = await screen.findByRole('group', { name: 'Priority' });
    await waitFor(() => expect(within(priority).getByLabelText('Question')).toHaveFocus());
  });

  it("saves a question's text when you leave the box, and Required at once", () => {
    const { saved } = renderFormView();
    const text = within(card('Name')).getByLabelText('Question');
    fireEvent.change(text, { target: { value: 'Customer name' } });
    fireEvent.blur(text);
    expect(saved().questions[0]).toMatchObject({ propertyId: PROPS.name, text: 'Customer name' });
    fireEvent.click(within(card('Customer name')).getByRole('switch', { name: 'Required' }));
    expect(saved().questions[0]).toMatchObject({ text: 'Customer name', required: true });
  });

  it('moves a question with Alt+Down, unless the move breaks its logic', () => {
    const { actions, saved } = renderFormView(formDatabase({ questions: threeQuestions }));
    fireEvent.keyDown(within(card('Priority')).getByLabelText('Question'), {
      key: 'ArrowDown',
      altKey: true,
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "'Notes' depends on 'Priority', so it must stay below it.",
    );
    expect(actions.updateView).not.toHaveBeenCalled();

    const nameBox = within(card('Name')).getByLabelText('Question');
    nameBox.focus();
    fireEvent.keyDown(nameBox, { key: 'ArrowDown', altKey: true });
    expect(order(saved())).toEqual([PROPS.priority, PROPS.name, PROPS.notes]);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(nameBox).toHaveFocus();
  });

  it('moves and removes questions from the question menu', async () => {
    const { saved } = renderFormView(formDatabase({ questions: threeQuestions }));
    const nameMenu = within(card('Name')).getByRole('button', { name: 'Question menu' });
    fireEvent.keyDown(nameMenu, { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: 'Move up' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move down' }));
    expect(order(saved())).toEqual([PROPS.priority, PROPS.name, PROPS.notes]);
    await waitFor(() => expect(nameMenu).toHaveFocus());

    choose(
      within(card('Priority')).getByRole('button', { name: 'Question menu' }),
      'Remove question',
    );
    expect(order(saved())).toEqual([PROPS.name, PROPS.notes]);
    expect(saved().questions[1]).toMatchObject({ logic: null, logicChanged: true });
    expect(within(card('Notes')).getByText('Logic changed')).toBeInTheDocument();
    await waitFor(() => expect(within(card('Name')).getByLabelText('Question')).toHaveFocus());
  });

  it('drags a question to a new place by its handle', () => {
    const { saved } = renderFormView(formDatabase({ questions: threeQuestions }));
    layOutCards();
    pointer(handle('Name'), 'pointerdown', 90);
    pointer(handle('Name'), 'pointermove', 400);
    expect(card('Name')).toHaveClass('opacity-50');
    pointer(handle('Name'), 'pointerup', 400);
    expect(order(saved())).toEqual([PROPS.priority, PROPS.name, PROPS.notes]);
    expect(card('Name')).not.toHaveClass('opacity-50');
  });

  it("FM-05: a drag that would break a question's logic is blocked with the message", () => {
    const { actions } = renderFormView(formDatabase({ questions: threeQuestions }));
    layOutCards();
    pointer(handle('Notes'), 'pointerdown', 490);
    pointer(handle('Notes'), 'pointermove', 100);
    pointer(handle('Notes'), 'pointerup', 100);
    expect(screen.getByRole('alert')).toHaveTextContent(
      "'Notes' depends on 'Priority', so it must stay below it.",
    );
    expect(actions.updateView).not.toHaveBeenCalled();
  });

  it('Escape cancels a drag', () => {
    const { actions } = renderFormView(formDatabase({ questions: threeQuestions }));
    layOutCards();
    pointer(handle('Name'), 'pointerdown', 90);
    pointer(handle('Name'), 'pointermove', 550);
    fireEvent.keyDown(handle('Name'), { key: 'Escape' });
    pointer(handle('Name'), 'pointerup', 550);
    expect(actions.updateView).not.toHaveBeenCalled();
    expect(card('Name')).not.toHaveClass('opacity-50');
  });

  it('"Show if…" sets up conditions on the questions above', () => {
    const { saved } = renderFormView(
      formDatabase({
        questions: [question(PROPS.name, 'Name'), question(PROPS.priority, 'Priority')],
      }),
    );
    expect(within(card('Name')).queryByRole('button', { name: 'Show if…' })).toBeNull();
    fireEvent.click(within(card('Priority')).getByRole('button', { name: 'Show if…' }));
    const logic = within(card('Priority')).getByRole('group', {
      name: 'Show this question only when…',
    });
    fireEvent.click(within(logic).getByRole('button', { name: 'Add condition' }));
    expect(saved().questions[1]?.logic).toMatchObject({
      combinator: 'and',
      conditions: [{ questionPropertyId: PROPS.name, op: 'is' }],
    });

    const row = within(logic).getByRole('group', { name: 'Condition 1' });
    fireEvent.change(within(row).getByLabelText('Condition'), { target: { value: 'contains' } });
    const value = within(row).getByLabelText('Value');
    fireEvent.change(value, { target: { value: 'Leak' } });
    fireEvent.blur(value);
    expect(saved().questions[1]?.logic?.conditions[0]).toMatchObject({
      questionPropertyId: PROPS.name,
      op: 'contains',
      value: 'Leak',
    });

    fireEvent.change(within(logic).getByLabelText('Match'), { target: { value: 'or' } });
    expect(saved().questions[1]?.logic?.combinator).toBe('or');
    fireEvent.click(within(row).getByRole('button', { name: 'Remove condition' }));
    expect(saved().questions[1]?.logic).toBeNull();
  });

  it('"New question" makes a property and asks it', async () => {
    const { client, saved } = renderFormView();
    choose(screen.getByRole('button', { name: 'Add question' }), 'New question');
    const form = screen.getByRole('form', { name: 'New question' });
    const name = within(form).getByLabelText('Question');
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'What happened?' } });
    fireEvent.change(within(form).getByLabelText('Type'), { target: { value: 'number' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Add question' }));

    await waitFor(() => expect(order(saved())).toEqual([PROPS.name, 'prop-new']));
    expect(client.createProperty).toHaveBeenCalledWith(JOBS_ID, {
      name: 'What happened?',
      config: defaultConfig('number'),
    });
    const asked = await screen.findByRole('group', { name: 'What happened?' });
    expect(screen.queryByRole('form', { name: 'New question' })).toBeNull();
    await waitFor(() => expect(within(asked).getByLabelText('Question')).toHaveFocus());
  });

  it('"New question" can be cancelled', async () => {
    const { client } = renderFormView();
    choose(screen.getByRole('button', { name: 'Add question' }), 'New question');
    const form = screen.getByRole('form', { name: 'New question' });
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'New question' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add question' })).toHaveFocus());
    expect(client.createProperty).not.toHaveBeenCalled();
  });

  it('starts an empty form from the list of properties', () => {
    const { saved } = renderFormView(formDatabase({ questions: [] }));
    expect(screen.getByText('Add your first question.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));
    expect(order(saved())).toEqual([PROPS.priority]);
  });

  it('leaves a refused save to the shell, which says why in a toast', async () => {
    const { actions } = renderFormView();
    const refused = new ApiError(409, 'conflict', 'This database changed. Reload to see it.');
    actions.updateView.mockRejectedValueOnce(refused);
    const title = screen.getByLabelText('Form title');
    fireEvent.change(title, { target: { value: 'Job request' } });
    fireEvent.blur(title);
    // Inside act, so anything the refusal changes would show before the check.
    await act(() => expect(actions.updateView.mock.results.at(-1)?.value).rejects.toBe(refused));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it("formats a question's description and saves it as rich text", () => {
    const { saved } = renderFormView();
    const description = within(card('Name')).getByRole('textbox', { name: 'Description' });
    act(() => {
      description.focus();
      description.textContent = 'Your full name';
      writeSelection(description, { start: 5, end: 9 });
    });
    fireEvent.input(description);
    fireEvent.click(within(card('Name')).getByRole('button', { name: 'Bold' }));
    act(() => description.blur());
    expect(saved().questions[0]?.description).toEqual([
      { text: 'Your ' },
      { text: 'full', marks: ['bold'] },
      { text: ' name' },
    ]);
  });

  it('FM-07: a description looks the same in the builder and in Preview', () => {
    const description: RichText = [
      { text: 'Call ' },
      { text: 'Blue Pine', marks: ['bold', 'underline'], color: 'blue' },
      { text: ' or see ' },
      { text: 'the guide', link: 'https://bluepine.example/guide' },
    ];
    renderFormView(formDatabase({ description }));
    const editing = screen.getByRole('textbox', { name: 'Form description' }).innerHTML;
    expect(editing).toContain('<strong class="font-semibold">Blue Pine</strong>');
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByText('Call or see').innerHTML).toBe(editing);
  });

  it('Preview shows the form as people fill it in', () => {
    renderFormView(formDatabase({ questions: threeQuestions }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Form title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit form' }));
    expect(screen.getByLabelText('Form title')).toHaveValue('Jobs');
  });

  it('FM-21: a form block in a page shows the fill screen, and Edit form opens the builder', () => {
    renderFormView(formDatabase({ questions: threeQuestions }, { inline: true }));
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Form title')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit form' }));
    expect(screen.getByLabelText('Form title')).toHaveValue('Jobs');
  });
});

describe('Form view settings', () => {
  it('saves the submit label and "Notify me"', () => {
    const { saved } = renderFormView();
    const settings = openSettings();
    const label = within(settings).getByLabelText('Submit button label');
    fireEvent.change(label, { target: { value: 'Send' } });
    fireEvent.blur(label);
    expect(saved().submitLabel).toBe('Send');
    fireEvent.click(
      within(settings).getByRole('switch', { name: 'Notify me about new responses' }),
    );
    expect(saved().notifyUserIds).toEqual([USERS.avery.id]);
  });

  it('closes at a date and after a number of responses', () => {
    const { saved } = renderFormView();
    const settings = openSettings();
    const closeAt = within(settings).getByLabelText('Close at a date');
    fireEvent.change(closeAt, { target: { value: '2026-10-30T17:00' } });
    fireEvent.blur(closeAt);
    expect(saved().closeAt).toBe('2026-10-30T23:00:00.000Z');

    const limit = within(settings).getByLabelText('Close after a number of responses');
    fireEvent.change(limit, { target: { value: '0' } });
    fireEvent.blur(limit);
    expect(within(settings).getByText('Enter a number.')).toBeInTheDocument();
    fireEvent.change(limit, { target: { value: '25' } });
    fireEvent.blur(limit);
    expect(saved().maxResponses).toBe(25);
    expect(within(settings).queryByText('Enter a number.')).toBeNull();
  });

  it('anonymous responses keep more than one response on and warn about typed answers', () => {
    const { saved } = renderFormView();
    const settings = openSettings();
    fireEvent.click(within(settings).getByRole('switch', { name: 'Anonymous responses' }));
    expect(saved().anonymous).toBe(true);
    expect(
      within(settings).getByText(
        'Answers can still show who sent them (Person questions, or what people type).',
      ),
    ).toBeInTheDocument();
    expect(
      within(settings).getByRole('switch', { name: 'Allow more than one response' }),
    ).toBeDisabled();
    expect(
      within(settings).getByText(
        'One response per person needs names. Turn off anonymous responses first.',
      ),
    ).toBeInTheDocument();
  });

  it('anonymous responses and closing need Full access', () => {
    renderFormView(formDatabase({}, { viewerAccess: 'edit' }));
    const settings = openSettings();
    expect(within(settings).getByRole('switch', { name: 'Anonymous responses' })).toBeDisabled();
    expect(within(settings).getByLabelText('Close at a date')).toBeDisabled();
    expect(within(settings).getByLabelText('Close after a number of responses')).toBeDisabled();
    expect(
      within(settings).getAllByText('Needs Full access on the database.').length,
    ).toBeGreaterThan(0);
    expect(
      within(settings).getByRole('switch', { name: 'Notify me about new responses' }),
    ).not.toBeDisabled();
  });
});

describe('Share form', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the link, then changes it', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { client } = renderFormView();
    const share = openShare();
    const link = within(share).getByLabelText('Form link');
    const url = `${window.location.origin}/forms/abc123`;
    expect(link).toHaveValue(url);
    fireEvent.click(within(share).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith(url);
    expect(await within(share).findByText('Link copied')).toBeInTheDocument();

    fireEvent.click(within(share).getByRole('button', { name: 'Change link' }));
    const confirm = within(share).getByRole('group', { name: 'Change link' });
    expect(within(confirm).getByText('The old link stops working at once.')).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Change link' }));
    await waitFor(() => expect(link).toHaveValue(`${window.location.origin}/forms/new-link-code`));
    expect(client.changeFormLink).toHaveBeenCalledWith(JOBS_ID, FORM_VIEW);
  });

  it('turns responses off and lets guests respond', () => {
    const { saved } = renderFormView();
    const share = openShare();
    fireEvent.click(within(share).getByRole('switch', { name: 'Accept responses' }));
    expect(saved().accepting).toBe(false);
    fireEvent.change(within(share).getByLabelText('Who can respond'), {
      target: { value: 'members_and_guests' },
    });
    expect(saved().audience).toBe('members_and_guests');
  });

  it('lets anyone on the network respond without signing in, always anonymously', () => {
    const { saved } = renderFormView(formDatabase({ allowMultiple: false }));
    const share = openShare();
    fireEvent.change(within(share).getByLabelText('Who can respond'), {
      target: { value: 'anyone' },
    });
    expect(saved()).toMatchObject({ audience: 'anyone', anonymous: true, allowMultiple: true });
    expect(
      within(share).getByText(
        'No sign-in. Always anonymous, with no Person or Relation questions.',
      ),
    ).toBeInTheDocument();
    const settings = openSettings();
    const anonymous = within(settings).getByRole('switch', { name: 'Anonymous responses' });
    expect(anonymous).toBeChecked();
    expect(anonymous).toBeDisabled();
    expect(
      within(settings).getByRole('switch', { name: 'Allow more than one response' }),
    ).toBeDisabled();
  });

  it('keeps anonymous on when the form goes back to members', () => {
    const { saved } = renderFormView(formDatabase());
    const share = openShare();
    fireEvent.change(within(share).getByLabelText('Who can respond'), {
      target: { value: 'anyone' },
    });
    fireEvent.change(within(share).getByLabelText('Who can respond'), {
      target: { value: 'members' },
    });
    expect(saved()).toMatchObject({ audience: 'members', anonymous: true });
  });

  it('keeps a form that asks for people to members', () => {
    const { actions } = renderFormView(
      formDatabase({
        questions: [question(PROPS.name, 'Name'), question(PROPS.technician, 'Technician')],
      }),
    );
    const share = openShare();
    fireEvent.change(within(share).getByLabelText('Who can respond'), {
      target: { value: 'anyone' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Forms anyone can fill in can't ask for people or rows.",
    );
    expect(actions.updateView).not.toHaveBeenCalled();
  });

  it('only Full access turns responses off or changes the link', () => {
    renderFormView(formDatabase({}, { viewerAccess: 'edit' }));
    const share = openShare();
    expect(within(share).getByRole('switch', { name: 'Accept responses' })).toBeDisabled();
    expect(within(share).getByLabelText('Who can respond')).toBeDisabled();
    expect(within(share).queryByRole('button', { name: 'Change link' })).toBeNull();
    expect(within(share).getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });
});

describe("Form view for people who can't build forms", () => {
  it('shows the fill screen from the form link', async () => {
    const { forms } = renderFormView(formDatabase({}, { viewerAccess: 'view' }));
    expect(await screen.findByRole('heading', { name: 'QA dispute request' })).toBeInTheDocument();
    expect(forms.getForm).toHaveBeenCalledWith('abc123');
    expect(screen.queryByLabelText('Form title')).toBeNull();
  });

  it('shows the fill screen when the database structure is locked', async () => {
    renderFormView(formDatabase({}, { locked: true }));
    expect(await screen.findByRole('heading', { name: 'QA dispute request' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share form' })).toBeNull();
  });
});
