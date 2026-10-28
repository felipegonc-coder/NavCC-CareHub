import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FileView } from './FileView';
import { viewProps } from './testing';

describe('FileView', () => {
  it('offers the file to download, with its name and description', () => {
    render(
      <FileView
        {...viewProps({
          id: 'block_1',
          type: 'file',
          fileId: 'file_7',
          name: 'Checklist.pdf',
          description: 'Print one for each room.',
        })}
      />,
    );
    expect(screen.getByText('Print one for each room.')).toBeInTheDocument();
    const download = screen.getByRole('link', { name: 'Download Checklist.pdf' });
    expect(download).toHaveAttribute('href', '/api/files/file_7?download=1');
    expect(download).toHaveAttribute('download');
  });
});
