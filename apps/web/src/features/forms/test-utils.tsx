/**
 * Test helpers for the form screens: a form with one question of most kinds, a mocked FormsClient
 * and render helpers. Nothing here touches the network. People and businesses are made up.
 */
import type { ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { vi, type Mock } from 'vitest';
import type {
  FormDefinition,
  FormQuestion,
  Id,
  Property,
  PropertyConfig,
  SelectOption,
} from '@carehub/databases';
import { defaultConfig } from '@carehub/databases';
import { ApiError } from '../databases/api';
import { FormsClientProvider, type FillForm, type FormsClient } from './api';
import { FormPage, SIGN_IN_PATH } from './form-page';

export const IDS = {
  name: 'prop-name',
  category: 'prop-category',
  reason: 'prop-reason',
  amount: 'prop-amount',
  visit: 'prop-visit',
  email: 'prop-email',
  photos: 'prop-photos',
  agree: 'prop-agree',
  assignee: 'prop-assignee',
  job: 'prop-job',
  site: 'prop-site',
  tags: 'prop-tags',
  notes: 'prop-notes',
} as const;

const property = (id: Id, name: string, config: PropertyConfig): Property => ({
  id,
  name,
  description: '',
  config,
  rowPage: 'always',
});

const options = (prefix: string, names: readonly string[]): SelectOption[] =>
  names.map((name, i) => ({ id: `${prefix}-${i + 1}`, name, color: 'default' }));

export const SITE_NAMES = [
  'North',
  'South',
  'East',
  'West',
  'Central',
  'Harbor',
  'Hills',
  'Valley',
];

export const formProperties: Property[] = [
  property(IDS.name, 'Name', { type: 'title' }),
  property(IDS.category, 'Category', {
    type: 'select',
    options: [
      { id: 'opt-billing', name: 'Billing', color: 'blue' },
      { id: 'opt-dispute', name: 'Dispute', color: 'red' },
      { id: 'opt-other', name: 'Other', color: 'gray' },
    ],
  }),
  property(IDS.reason, 'Reason', { type: 'text' }),
  property(IDS.amount, 'Amount', defaultConfig('number')),
  property(IDS.visit, 'Visit date', defaultConfig('date')),
  property(IDS.email, 'Email', { type: 'email' }),
  property(IDS.photos, 'Photos', { type: 'files' }),
  property(IDS.agree, 'Terms', { type: 'checkbox' }),
  property(IDS.assignee, 'Assigned to', { type: 'person', single: true, notify: false }),
  property(IDS.job, 'Job', {
    type: 'relation',
    targetDatabaseId: 'db-jobs',
    single: false,
    twoWayPropertyId: null,
  }),
  property(IDS.site, 'Site', { type: 'select', options: options('opt-site', SITE_NAMES) }),
  property(IDS.tags, 'Tags', {
    type: 'multi_select',
    options: options('opt-tag', ['Leak', 'Noise', 'Smell']),
  }),
  property(IDS.notes, 'Notes', { type: 'text' }),
];

export function question(
  propertyId: Id,
  text: string,
  extra: Partial<FormQuestion> = {},
): FormQuestion {
  return {
    propertyId,
    text,
    description: [],
    required: false,
    display: 'default',
    logic: null,
    ...extra,
  };
}

/** "Reason for dispute" shows only when Category is Dispute. */
export const reasonQuestion = question(IDS.reason, 'Reason for dispute', {
  required: true,
  logic: {
    combinator: 'and',
    conditions: [
      { id: 'cond-1', questionPropertyId: IDS.category, op: 'is_any_of', value: ['opt-dispute'] },
    ],
  },
});

export function testForm(overrides: Partial<FormDefinition> = {}): FormDefinition {
  return {
    title: 'QA dispute request',
    description: [
      { text: 'Tell us what ' },
      { text: 'went wrong', marks: ['bold'] },
      { text: '. Read ' },
      { text: 'our policy', link: 'https://example.com/policy' },
      { text: ' first.' },
    ],
    questions: [
      question(IDS.name, 'Your name', { required: true }),
      question(IDS.category, 'Category', { required: true }),
      reasonQuestion,
      question(IDS.amount, 'Amount'),
      question(IDS.email, 'Email'),
    ],
    submitLabel: 'Send request',
    confirmation: [{ text: 'Thanks! Your response was sent.' }],
    allowMultiple: true,
    accepting: true,
    linkCode: 'code-123',
    linkChangedAt: null,
    anonymous: false,
    notifyUserIds: [],
    ...overrides,
  };
}

export function fillForm(
  form: Partial<FormDefinition> = {},
  overrides: Partial<FillForm> = {},
): FillForm {
  return {
    formId: 'form-1',
    databaseId: 'db-requests',
    form: testForm(form),
    properties: formProperties,
    gate: { state: 'open', message: null },
    respondent: { userId: 'user-avery', timeZone: 'America/Denver' },
    ...overrides,
  };
}

export type MockFormsClient = { [K in keyof FormsClient]: Mock<FormsClient[K]> };

export const NOT_FOUND = 'This was deleted, or the link is wrong.';

/** A FormsClient answering from fillForm(). */
export function mockFormsClient(data: FillForm = fillForm()): MockFormsClient {
  return {
    getForm: vi.fn<FormsClient['getForm']>().mockResolvedValue(data),
    submitResponse: vi.fn<FormsClient['submitResponse']>().mockResolvedValue({ ok: true }),
    // Not a form anyone can fill in, unless a test says so.
    getPublicForm: vi
      .fn<FormsClient['getPublicForm']>()
      .mockRejectedValue(new ApiError(404, 'not_found', NOT_FOUND)),
    submitPublicResponse: vi
      .fn<FormsClient['submitPublicResponse']>()
      .mockResolvedValue({ ok: true }),
    searchPeople: vi.fn<FormsClient['searchPeople']>().mockResolvedValue([
      { id: 'user-avery', name: 'Avery Lin', email: 'avery@bluepine.example' },
      { id: 'user-jordan', name: 'Jordan Park', email: 'jordan@bluepine.example' },
    ]),
    pickRows: vi
      .fn<FormsClient['pickRows']>()
      .mockResolvedValue([{ id: 'row-leak', title: 'Blue Pine Plumbing: kitchen leak' }]),
    uploadFile: vi.fn<FormsClient['uploadFile']>().mockImplementation((file) =>
      Promise.resolve({
        id: `file-${file.name}`,
        name: file.name,
        size: file.size,
        mimeType: file.type,
        url: `/api/files/file-${file.name}`,
      }),
    ),
  };
}

/** Renders a form screen with this client. */
export function renderWithForms(ui: ReactElement, client: MockFormsClient = mockFormsClient()) {
  const view = render(<FormsClientProvider client={client}>{ui}</FormsClientProvider>);
  return { ...view, client };
}

/** Opens `/forms/<code>` the way the app does, with a stand-in sign-in screen. */
export function renderFormPage(code: string, client: MockFormsClient = mockFormsClient()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FormsClientProvider client={client}>
        <MemoryRouter initialEntries={[`/forms/${code}`]}>
          <Routes>
            <Route path="/forms/:code" element={<FormPage />} />
            <Route path={SIGN_IN_PATH} element={<p>Sign in screen</p>} />
          </Routes>
        </MemoryRouter>
      </FormsClientProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

/** Radix switches and checkboxes in a form measure themselves; jsdom has no ResizeObserver. */
export function stubResizeObserver(): void {
  if (typeof globalThis.ResizeObserver === 'function') return;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
}
