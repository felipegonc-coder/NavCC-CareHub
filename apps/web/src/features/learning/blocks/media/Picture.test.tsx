import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Picture } from './Picture';
import { picture } from './testing';

describe('Picture', () => {
  it('shows an uploaded picture with its description and caption', () => {
    render(<Picture image={{ ...picture('Ward map'), caption: 'Level 2' }} />);
    expect(screen.getByRole('img', { name: 'Ward map' })).toHaveAttribute(
      'src',
      '/api/files/file_1',
    );
    expect(screen.getByText('Level 2').tagName).toBe('FIGCAPTION');
  });

  it('gives a decorative picture no description', () => {
    const { container } = render(<Picture image={{ ...picture('Swirls'), decorative: true }} />);
    expect(container.querySelector('img')).toHaveAttribute('alt', '');
    expect(screen.queryByRole('img', { name: 'Swirls' })).not.toBeInTheDocument();
  });

  it('says so, with the description, when the picture can’t be loaded', () => {
    const { container, rerender } = render(<Picture image={picture('Ward map')} />);
    const img = container.querySelector('img');
    if (!img) throw new Error('No picture.');
    fireEvent.error(img);
    expect(screen.getByText("This picture couldn't be loaded.")).toBeInTheDocument();
    expect(screen.getByText('It shows: Ward map')).toBeInTheDocument();
    rerender(<Picture image={picture('Ward map', 'file_2')} />);
    expect(screen.getByRole('img', { name: 'Ward map' })).toHaveAttribute(
      'src',
      '/api/files/file_2',
    );
  });
});
