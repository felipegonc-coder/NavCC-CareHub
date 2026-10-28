import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError, UNKNOWN_ERROR_MESSAGE } from '../databases/api';
import { fillForm, IDS, mockFormsClient, renderFormPage, stubResizeObserver } from './test-utils';

const unauthorized = () => new ApiError(401, 'unauthorized', 'Sign in to continue.');
const NOT_RECORDED = "Your name isn't recorded with this form.";

beforeEach(() => {
  window.localStorage.clear();
  stubResizeObserver();
});

describe('FormPage', () => {
  it('opens the form behind the link for the person signed in', async () => {
    const { client } = renderFormPage('code-123');
    expect(await screen.findByRole('form', { name: 'QA dispute request' })).toBeInTheDocument();
    expect(client.getForm).toHaveBeenCalledWith('code-123');
    await waitFor(() => expect(document.title).toBe('Care Hub · QA dispute request'));
  });

  it('sends people who are signed out to sign in', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(unauthorized());
    renderFormPage('code-123', client);
    expect(await screen.findByText('Sign in screen')).toBeInTheDocument();
  });

  it('opens a form anyone can fill in without signing in, and sends it the public way', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValue(unauthorized());
    client.getPublicForm.mockResolvedValue(fillForm({ audience: 'anyone' }, { respondent: null }));
    renderFormPage('code-123', client);
    expect(await screen.findByRole('form', { name: 'QA dispute request' })).toBeInTheDocument();
    expect(client.getPublicForm).toHaveBeenCalledWith('code-123');
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), {
      target: { value: 'Avery Lin' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Billing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(client.submitPublicResponse).toHaveBeenCalledTimes(1));
    expect(client.submitResponse).not.toHaveBeenCalled();
  });

  it('reloads a form that stopped being anonymous, keeping the answers', async () => {
    const client = mockFormsClient();
    client.getForm
      .mockResolvedValueOnce(fillForm({ anonymous: true }))
      .mockResolvedValue(fillForm({ anonymous: false }));
    client.submitResponse.mockRejectedValueOnce(
      new ApiError(409, 'form_changed', 'This form changed. Check your answers and send again.'),
    );
    renderFormPage('code-123', client);
    expect(await screen.findByText(NOT_RECORDED)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Your name' }), {
      target: { value: 'Avery Lin' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Billing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));
    const answers = { [IDS.name]: 'Avery Lin', [IDS.category]: 'opt-billing' };
    expect(
      await screen.findByText('This form changed. Check your answers and send again.'),
    ).toBeInTheDocument();
    expect(client.submitResponse).toHaveBeenCalledWith('code-123', { answers, anonymous: true });
    await waitFor(() => expect(screen.queryByText(NOT_RECORDED)).toBeNull());
    expect(client.getForm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: 'Your name' })).toHaveValue('Avery Lin');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Thanks! Your response was sent.');
    expect(client.submitResponse).toHaveBeenLastCalledWith('code-123', {
      answers,
      anonymous: false,
    });
  });

  it('says why the form could not open, with Retry', async () => {
    const client = mockFormsClient();
    client.getForm.mockRejectedValueOnce(new ApiError(500, 'unknown', UNKNOWN_ERROR_MESSAGE));
    renderFormPage('code-123', client);
    expect(await screen.findByRole('alert')).toHaveTextContent(UNKNOWN_ERROR_MESSAGE);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('form', { name: 'QA dispute request' })).toBeInTheDocument();
    expect(client.getForm).toHaveBeenCalledTimes(2);
  });
});
