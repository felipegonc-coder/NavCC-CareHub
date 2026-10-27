import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError, UNKNOWN_ERROR_MESSAGE } from '../databases/api';
import { mockFormsClient, renderFormPage } from './test-utils';

const unauthorized = () => new ApiError(401, 'unauthorized', 'Sign in to continue.');

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
