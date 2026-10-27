import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { FormDefinition } from '@carehub/databases';
import { draftKey } from '@carehub/databases/forms';
import { ApiError } from '../databases/api';
import type { FillForm } from './api';
import { FormFill, OFFLINE_TEXT } from './form-fill';
import {
  fillForm,
  IDS,
  mockFormsClient,
  question,
  renderWithForms,
  stubResizeObserver,
  type MockFormsClient,
} from './test-utils';

function renderFill(
  form: Partial<FormDefinition> = {},
  { data }: { data?: Partial<FillForm> } = {},
  client: MockFormsClient = mockFormsClient(),
) {
  const filled = fillForm(form, data);
  return renderWithForms(<FormFill data={filled} code="code-123" />, client);
}

const textbox = (name: string) => screen.getByRole('textbox', { name });
const COVER = { id: 'file-cover', name: 'van.jpg', size: 2048, mime: 'image/jpeg' };
const submitButton = () => screen.getByRole('button', { name: 'Send request' });

function answerRequired() {
  fireEvent.change(textbox('Your name'), { target: { value: 'Avery Lin' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Billing' }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  stubResizeObserver();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FormFill', () => {
  it('shows the form named after its title, with its description and submit label', () => {
    renderFill();
    expect(screen.getByRole('form', { name: 'QA dispute request' })).toBeInTheDocument();
    expect(screen.getByText('went wrong').tagName).toBe('STRONG');
    const link = screen.getByRole('link', { name: 'our policy' });
    expect(link).toHaveAttribute('href', 'https://example.com/policy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(textbox('Your name')).toBeRequired();
    expect(submitButton()).toBeInTheDocument();
  });

  it('uses radio buttons for up to 7 options and a searchable dropdown for more', () => {
    renderFill({ questions: [question(IDS.category, 'Category'), question(IDS.site, 'Site')] });
    const group = screen.getByRole('radiogroup', { name: 'Category' });
    expect(within(group).getAllByRole('radio')).toHaveLength(3);
    const site = screen.getByRole('combobox', { name: 'Site' });
    fireEvent.change(site, { target: { value: 'har' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Harbor' }));
    expect(screen.getByRole('button', { name: 'Remove Harbor' })).toBeInTheDocument();
  });

  it('shows a question when its logic matches and reads it out without moving the focus', () => {
    renderFill();
    expect(screen.queryByRole('textbox', { name: 'Reason for dispute' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Dispute' }));
    expect(textbox('Reason for dispute')).not.toHaveFocus();
    expect(screen.getByText('1 new question: Reason for dispute')).toBeInTheDocument();
  });

  it('lists the questions that need answers and moves the focus to the first', () => {
    const { client } = renderFill();
    fireEvent.click(submitButton());
    expect(screen.getByText('2 questions need answers')).toBeInTheDocument();
    expect(screen.getAllByText('Answer this question.')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Category' })).toHaveAttribute(
      'href',
      `#question-${IDS.category}`,
    );
    expect(textbox('Your name')).toHaveFocus();
    expect(textbox('Your name')).toHaveAttribute('aria-invalid', 'true');
    expect(client.submitResponse).not.toHaveBeenCalled();
  });

  it('sends the answers to the questions that show, then confirms', async () => {
    const { client } = renderFill({ allowMultiple: true });
    answerRequired();
    fireEvent.change(textbox('Amount'), { target: { value: '12.5' } });
    fireEvent.click(submitButton());
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Thanks! Your response was sent.');
    expect(client.submitResponse).toHaveBeenCalledTimes(1);
    expect(client.submitResponse).toHaveBeenCalledWith('code-123', {
      answers: { [IDS.name]: 'Avery Lin', [IDS.category]: 'opt-billing', [IDS.amount]: '12.5' },
      anonymous: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit another response' }));
    expect(textbox('Your name')).toHaveValue('');
  });

  it('offers no second response when only one is allowed', async () => {
    renderFill({ allowMultiple: false });
    answerRequired();
    fireEvent.click(submitButton());
    await screen.findByRole('status');
    expect(screen.queryByRole('button', { name: 'Submit another response' })).toBeNull();
  });

  it('checks an answer when the person leaves it', () => {
    renderFill();
    fireEvent.change(textbox('Email'), { target: { value: 'avery' } });
    fireEvent.blur(textbox('Email'));
    expect(screen.getByText('Enter an email address like name@example.com.')).toBeInTheDocument();
    expect(textbox('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('never sends with Enter in a short answer; Ctrl+Enter sends', async () => {
    const { client } = renderFill();
    answerRequired();
    expect(fireEvent.keyDown(textbox('Your name'), { key: 'Enter' })).toBe(false);
    expect(client.submitResponse).not.toHaveBeenCalled();
    fireEvent.keyDown(textbox('Your name'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(client.submitResponse).toHaveBeenCalledTimes(1));
  });

  it('keeps unsent answers in a draft and clears it once sent', async () => {
    const key = draftKey('form-1', 'user-avery');
    window.localStorage.setItem(key, JSON.stringify({ answers: { [IDS.name]: 'Jordan Park' } }));
    renderFill();
    expect(textbox('Your name')).toHaveValue('Jordan Park');
    fireEvent.click(screen.getByRole('radio', { name: 'Other' }));
    expect(window.localStorage.getItem(key)).toContain('opt-other');
    fireEvent.click(submitButton());
    await screen.findByRole('status');
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('says why sending failed, keeps the answers and sends again with Retry', async () => {
    const client = mockFormsClient();
    client.submitResponse.mockRejectedValueOnce(
      new ApiError(429, 'rate_limited', 'Too many responses. Try again in a minute.'),
    );
    renderFill({}, {}, client);
    answerRequired();
    fireEvent.click(submitButton());
    expect(
      await screen.findByText('Too many responses. Try again in a minute.'),
    ).toBeInTheDocument();
    expect(textbox('Your name')).toHaveValue('Avery Lin');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('status');
    expect(client.submitResponse).toHaveBeenCalledTimes(2);
  });

  it('keeps the answers when offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const { client } = renderFill();
    answerRequired();
    fireEvent.click(submitButton());
    expect(screen.getByText(OFFLINE_TEXT)).toBeInTheDocument();
    expect(client.submitResponse).not.toHaveBeenCalled();
  });

  it('shows the gate message instead of the form', () => {
    renderFill(
      {},
      { data: { gate: { state: 'closed', message: 'This form closed on Oct 30, 2026.' } } },
    );
    expect(screen.getByText('This form closed on Oct 30, 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('says names are not recorded on an anonymous form, and sends that it said so', async () => {
    const { client } = renderFill({ anonymous: true });
    expect(screen.getByText("Your name isn't recorded with this form.")).toBeInTheDocument();
    answerRequired();
    fireEvent.click(submitButton());
    await screen.findByRole('status');
    expect(client.submitResponse).toHaveBeenCalledWith('code-123', {
      answers: { [IDS.name]: 'Avery Lin', [IDS.category]: 'opt-billing' },
      anonymous: true,
    });
  });

  it('asks for a tick on a required checkbox', () => {
    renderFill({ questions: [question(IDS.agree, 'I agree to the terms', { required: true })] });
    fireEvent.click(submitButton());
    expect(screen.getByText('Tick this box to continue.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I agree to the terms' }));
    expect(screen.queryByText('Tick this box to continue.')).toBeNull();
  });

  it('takes a date with an end and a time', async () => {
    const { client } = renderFill({ questions: [question(IDS.visit, 'Visit date')] });
    fireEvent.change(screen.getByLabelText('Visit date'), { target: { value: '2026-10-27' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Include time' }));
    expect(screen.getByLabelText('Time')).toHaveValue('09:00');
    fireEvent.click(screen.getByRole('switch', { name: 'End date' }));
    expect(screen.getByLabelText('End')).toHaveValue('2026-10-27');
    fireEvent.click(submitButton());
    await waitFor(() => expect(client.submitResponse).toHaveBeenCalled());
    expect(client.submitResponse.mock.calls[0]?.[1].answers).toEqual({
      [IDS.visit]: {
        start: '2026-10-27T15:00:00.000Z',
        end: '2026-10-27T15:00:00.000Z',
        hasTime: true,
      },
    });
  });

  it('picks people and rows by searching', async () => {
    const { client } = renderFill({
      questions: [question(IDS.assignee, 'Assigned to'), question(IDS.job, 'Job')],
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Assigned to' }), {
      target: { value: 'Av' },
    });
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'Avery Lin' }));
    expect(client.searchPeople).toHaveBeenCalledWith('Av');
    fireEvent.change(screen.getByRole('combobox', { name: 'Job' }), { target: { value: 'leak' } });
    fireEvent.mouseDown(
      await screen.findByRole('option', { name: 'Blue Pine Plumbing: kitchen leak' }),
    );
    expect(client.pickRows).toHaveBeenCalledWith('db-jobs', 'leak');
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(client.submitResponse).toHaveBeenCalledWith('code-123', {
        answers: { [IDS.assignee]: ['user-avery'], [IDS.job]: ['row-leak'] },
        anonymous: false,
      }),
    );
  });

  it('sends through the public route when nobody is signed in', async () => {
    const client = mockFormsClient();
    const data = fillForm({ audience: 'anyone' }, { respondent: null });
    renderWithForms(<FormFill data={data} code="code-123" signedOut />, client);
    expect(screen.getByText("Your name isn't recorded with this form.")).toBeInTheDocument();
    answerRequired();
    fireEvent.click(submitButton());
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks! Your response was sent.');
    expect(client.submitPublicResponse).toHaveBeenCalledWith('code-123', {
      answers: { [IDS.name]: 'Avery Lin', [IDS.category]: 'opt-billing' },
      anonymous: true,
    });
    expect(client.submitResponse).not.toHaveBeenCalled();
  });

  it('keeps a signed-out draft in this tab only, never in the browser', async () => {
    const key = draftKey('form-1', null);
    window.sessionStorage.setItem(key, JSON.stringify({ answers: { [IDS.name]: 'Jordan Park' } }));
    const data = fillForm({ audience: 'anyone' }, { respondent: null });
    renderWithForms(<FormFill data={data} code="code-123" signedOut />);
    expect(textbox('Your name')).toHaveValue('Jordan Park');
    fireEvent.click(screen.getByRole('radio', { name: 'Billing' }));
    expect(window.sessionStorage.getItem(key)).toContain('opt-billing');
    expect(window.localStorage.length).toBe(0);
    fireEvent.click(submitButton());
    await screen.findByRole('status');
    expect(window.sessionStorage.getItem(key)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('shows an uploaded cover from the files API', () => {
    renderFill({ cover: COVER });
    expect(document.querySelector('img')).toHaveAttribute('src', '/api/files/file-cover');
  });

  it("shows the cover from the form's link with nobody signed in, and leaves out one that fails", () => {
    const data = fillForm({ audience: 'anyone', cover: COVER }, { respondent: null });
    renderWithForms(<FormFill data={data} code="code-123" signedOut />);
    const cover = document.querySelector('img');
    expect(cover).toHaveAttribute('src', '/api/forms/public/code-123/cover');
    if (cover) fireEvent.error(cover);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByRole('form', { name: 'QA dispute request' })).toBeInTheDocument();
  });

  it('uploads files to the form, signed in', async () => {
    const { client } = renderFill({ questions: [question(IDS.photos, 'Photos')] });
    const file = new File(['leak'], 'sink.heic', { type: 'image/heic' });
    fireEvent.change(screen.getByLabelText('Photos'), { target: { files: [file] } });
    expect(await screen.findByText('sink.heic')).toBeInTheDocument();
    expect(client.uploadFile).toHaveBeenCalledWith(file, { scope: 'forms:form-1' });
  });
});
