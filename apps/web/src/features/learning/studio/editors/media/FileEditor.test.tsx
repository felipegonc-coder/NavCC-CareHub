import type { FileBlock } from '@carehub/learning';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeRequests, fileInput, sent } from '../../../media/testing';
import { FileEditor } from './FileEditor';
import { renderEditor } from './testing';

// Fictional content only.
const block: FileBlock = { id: 'block_1', type: 'file', fileId: 'file_1', name: 'Rota.pdf' };

let restore = () => {};
beforeEach(() => {
  restore = fakeRequests();
});
afterEach(() => restore());

describe('FileEditor', () => {
  it('edits the name and the optional description', () => {
    const { latest } = renderEditor(FileEditor, block);
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), {
      target: { value: 'June rota' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: 'Who is on call.' },
    });
    expect(latest()).toMatchObject({ name: 'June rota', description: 'Who is on call.' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '' },
    });
    expect(latest()).not.toHaveProperty('description');
  });

  it('replaces the file with an upload, taking its name', async () => {
    const { container, latest } = renderEditor(FileEditor, block);
    const pdf = new File(['%PDF-1.7\n%%EOF\n'], 'July rota.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput(container), { target: { files: [pdf] } });
    await waitFor(() => expect(sent().url).toContain('/api/files'));
    act(() =>
      sent().answer(201, {
        id: 'file_2',
        name: 'July rota.pdf',
        size: pdf.size,
        mimeType: 'application/pdf',
        url: '/api/files/file_2',
      }),
    );
    await waitFor(() =>
      expect(latest()).toMatchObject({ fileId: 'file_2', name: 'July rota.pdf' }),
    );
  });
});
