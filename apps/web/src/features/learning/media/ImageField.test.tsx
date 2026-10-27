import type { Image } from '@carehub/learning';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageField, type ImageFieldProps } from './ImageField';
import { FakeRequest, fakeFetch, fakeRequests, fileInput, pngFile, sent } from './testing';

let restore = () => {};
let changes: (Image | undefined)[] = [];
beforeEach(() => {
  restore = fakeRequests();
  changes = [];
});
afterEach(() => restore());

type HarnessProps = Omit<ImageFieldProps, 'value' | 'onChange'> & { initial?: Image };

function Harness({ initial, ...props }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <ImageField
      value={value}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
      {...props}
    />
  );
}

const uploaded: Image = { media: { kind: 'file', fileId: 'file_1' }, alt: 'Ward map' };
const button = (name: string) => screen.getByRole('button', { name });
const altText = () => screen.getByRole('textbox', { name: 'Alt text' });
const last = () => changes[changes.length - 1];

describe('ImageField', () => {
  it('uploads a chosen picture, then asks for its alt text', async () => {
    const { container } = render(<Harness label="Cover picture" courseId="course_1" />);
    expect(screen.getByRole('group', { name: 'Cover picture' })).toBeInTheDocument();
    fireEvent.change(fileInput(container), {
      target: { files: [pngFile('Ward map.png', 40, 30)] },
    });
    await waitFor(() => expect(FakeRequest.last).toBeDefined());
    act(() =>
      sent().answer(201, {
        id: 'file_1',
        name: 'Ward map.png',
        size: 33,
        mimeType: 'image/png',
        url: '/api/files/file_1',
      }),
    );
    await waitFor(() => expect(changes).toHaveLength(1));
    expect(last()).toEqual({ media: { kind: 'file', fileId: 'file_1' }, alt: '' });
    expect(container.querySelector('img')).toHaveAttribute('src', '/api/files/file_1');
    await waitFor(() => expect(altText()).toHaveFocus());
  });

  it('edits the alt text, "Decorative" and the caption', () => {
    render(<Harness initial={uploaded} courseId="course_1" />);
    expect(screen.getByRole('img', { name: 'Ward map' })).toBeInTheDocument();

    fireEvent.change(altText(), { target: { value: 'Map of ward 3' } });
    expect(last()).toEqual({ ...uploaded, alt: 'Map of ward 3' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Decorative' }));
    expect(last()).toEqual({ ...uploaded, alt: 'Map of ward 3', decorative: true });
    expect(altText()).toBeDisabled();
    expect(screen.queryByRole('img')).not.toBeInTheDocument(); // alt="" now: screen readers skip it
    fireEvent.click(screen.getByRole('checkbox', { name: 'Decorative' }));
    expect(last()).toEqual({ ...uploaded, alt: 'Map of ward 3' });

    const caption = screen.getByRole('textbox', { name: 'Caption' });
    fireEvent.change(caption, { target: { value: 'Level 2' } });
    expect(last()).toEqual({ ...uploaded, alt: 'Map of ward 3', caption: 'Level 2' });
    fireEvent.change(caption, { target: { value: '' } });
    expect(last()).toEqual({ ...uploaded, alt: 'Map of ward 3' });
  });

  it('has no caption box when captions are off', () => {
    render(<Harness initial={uploaded} courseId="course_1" caption={false} />);
    expect(screen.queryByRole('textbox', { name: 'Caption' })).not.toBeInTheDocument();
  });

  it('replaces a picture with a copied link, keeping the caption and asking for new alt text', async () => {
    const fetches = fakeFetch();
    try {
      render(<Harness initial={{ ...uploaded, caption: 'Level 2' }} courseId="course_1" />);
      fireEvent.click(button('Replace'));
      expect(button('Choose a file')).toHaveFocus();
      fireEvent.change(screen.getByRole('textbox', { name: 'Or paste a link' }), {
        target: { value: 'https://example.org/map.png' },
      });
      fireEvent.click(button('Use link'));
      act(() =>
        fetches.calls[0]?.answer(201, {
          id: 'file_2',
          name: 'map.png',
          size: 33,
          mimeType: 'image/png',
          url: '/api/files/file_2',
        }),
      );
      await waitFor(() => expect(changes).toHaveLength(1));
      expect(last()).toEqual({
        media: { kind: 'file', fileId: 'file_2' },
        alt: '',
        caption: 'Level 2',
      });
      await waitFor(() => expect(altText()).toHaveFocus());
    } finally {
      fetches.restore();
    }
  });

  it('offers no cropping for a picture that is a link', () => {
    const linked: Image = {
      media: { kind: 'url', url: 'https://example.org/map.png' },
      alt: 'Map',
    };
    render(<Harness initial={linked} courseId="course_1" />);
    expect(screen.queryByRole('button', { name: 'Crop' })).not.toBeInTheDocument();
    expect(button('Replace')).toBeEnabled();
  });

  it('keeps the current picture when replacing is called off', () => {
    render(<Harness initial={uploaded} courseId="course_1" />);
    fireEvent.click(button('Replace'));
    fireEvent.click(button('Keep the current picture'));
    expect(changes).toHaveLength(0);
    expect(button('Replace')).toHaveFocus();
  });

  it('removes the picture', () => {
    render(<Harness initial={uploaded} courseId="course_1" />);
    fireEvent.click(button('Remove'));
    expect(changes).toEqual([undefined]);
    expect(button('Choose a file')).toHaveFocus();
  });

  it('opens the crop dialog for an uploaded picture and returns to Crop when it closes', () => {
    render(<Harness initial={uploaded} courseId="course_1" aspect="16:9" />);
    fireEvent.click(button('Crop'));
    expect(screen.getByRole('dialog', { name: 'Crop picture' })).toBeInTheDocument();
    fireEvent.click(button('Cancel'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button('Crop')).toHaveFocus();
  });

  it('says so when the picture cannot be loaded', () => {
    render(<Harness initial={uploaded} courseId="course_1" />);
    fireEvent.error(screen.getByRole('img', { name: 'Ward map' }));
    expect(screen.getByRole('alert')).toHaveTextContent("This picture couldn't be loaded.");
    expect(button('Crop')).toBeDisabled();
  });

  it('cannot crop or upload before the course is saved', () => {
    render(<Harness initial={uploaded} />);
    expect(button('Crop')).toBeDisabled();
    fireEvent.click(button('Replace'));
    expect(button('Choose a file')).toBeDisabled();
    expect(screen.getByText('Save the course before adding files.')).toBeInTheDocument();
  });
});
