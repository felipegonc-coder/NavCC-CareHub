import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { FormDefinition } from '@carehub/databases';
import { draftKey } from '@carehub/databases/forms';
import { ApiError } from '../databases/api';
import type { FillAccess, FillForm } from './api';
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
import { PUBLIC_UPLOAD_REFUSED } from './uploads';

function renderFill(
  form: Partial<FormDefinition> = {},
  { access = 'member', data }: { access?: FillAccess; data?: Partial<FillForm> } = {},
  client: MockFormsClient = mockFormsClient(),
) {
  const filled = fillForm(form, data);
  return renderWithForms(<FormFill data={filled} access={access} code="code-123" />, client);
}

const textbox = (name: string) => screen.getByRole('textbox', { name });
const submitButton = () => screen.getByRole('button', { name: 'Send request' });

function answerRequired() {
  fireEvent.change(textbox('Your name'), { target: { value: 'Avery Lin' } });
  fireEvent.click(screen.getByRole('radio', { name: 'Billing' }));
}

beforeEach(() => {
  window.localStorage.clear();
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
    expect(client.submitResponse).toHaveBeenCalledWith(
      'code-123',
      { [IDS.name]: 'Avery Lin', [IDS.category]: 'opt-billing', [IDS.amount]: '12.5' },
      'member',
    );
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

  it('says names are not recorded on an anonymous form', () => {
    renderFill({ anonymous: true });
    expect(screen.getByText("Your name isn't recorded with this form.")).toBeInTheDocument();
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
    expect(client.submitResponse.mock.calls[0]?.[1]).toEqual({
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
      expect(client.submitResponse).toHaveBeenCalledWith(
        'code-123',
        { [IDS.assignee]: ['user-avery'], [IDS.job]: ['row-leak'] },
        'member',
      ),
    );
  });

  it('uploads files to the form, signed in', async () => {
    const { client } = renderFill({ questions: [question(IDS.photos, 'Photos')] });
    const file = new File(['leak'], 'sink.heic', { type: 'image/heic' });
    fireEvent.change(screen.getByLabelText('Photos'), { target: { files: [file] } });
    expect(await screen.findByText('sink.heic')).toBeInTheDocument();
    expect(client.uploadFile).toHaveBeenCalledWith(file, { scope: 'forms:form-1' });
  });
});

describe('FormFill for a form anyone can fill in', () => {
  const questions = [
    question(IDS.name, 'Your name'),
    question(IDS.assignee, 'Assigned to'),
    question(IDS.job, 'Job'),
    question(IDS.photos, 'Photos'),
  ];
  const publicData: Partial<FillForm> = { respondent: null };

  it('never asks Person or Relation questions and says names are not recorded', () => {
    renderFill({ questions, audience: 'anyone' }, { access: 'public', data: publicData });
    expect(textbox('Your name')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText("Your name isn't recorded with this form.")).toBeInTheDocument();
  });

  it('takes only the allowed file types and sends its own uploads', async () => {
    const { client } = renderFill(
      { questions, audience: 'anyone' },
      { access: 'public', data: publicData },
    );
    const input = screen.getByLabelText('Photos');
    expect(input.getAttribute('accept')).toContain('.docx');
    expect(input.getAttribute('accept')).not.toContain('.docm');

    fireEvent.change(input, { target: { files: [new File(['x'], 'macro.docm')] } });
    expect(screen.getByText(PUBLIC_UPLOAD_REFUSED)).toBeInTheDocument();
    expect(client.uploadFile).not.toHaveBeenCalled();

    const photo = new File(['leak'], 'sink.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [photo] } });
    expect(await screen.findByText('sink.png')).toBeInTheDocument();
    fireEvent.click(submitButton());
    await waitFor(() =>
      expect(client.submitResponse).toHaveBeenCalledWith(
        'code-123',
        { [IDS.photos]: [{ id: 'file-sink.png', name: 'sink.png', size: 4, mime: 'image/png' }] },
        'public',
      ),
    );
    expect(window.localStorage.getItem(draftKey('form-1', null))).toBeNull();
  });
});
