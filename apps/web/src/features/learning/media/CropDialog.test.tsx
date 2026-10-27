import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CropDialog } from './CropDialog';
import { FakeRequest, fakeCanvas, fakeRequests, loadPicture, sent, sentFile } from './testing';

let restore = () => {};
beforeEach(() => {
  restore = fakeRequests();
});
afterEach(() => restore());

type Cropped = Parameters<Parameters<typeof CropDialog>[0]['onCropped']>[0];

function open(props: Partial<Parameters<typeof CropDialog>[0]> = {}) {
  const result = { cancelled: 0, cropped: [] as Cropped[] };
  render(
    <CropDialog
      src="/api/files/file_1"
      alt="Ward map"
      scope="learning:course_1"
      onCancel={() => result.cancelled++}
      onCropped={(cropped) => result.cropped.push(cropped)}
      {...props}
    />,
  );
  return result;
}

const picture = () => screen.getByRole('img', { name: 'Ward map' }) as HTMLImageElement;
const apply = () => screen.getByRole('button', { name: 'Apply crop' });
const result = () => screen.getByText(/^The cropped picture will be/).textContent;

describe('CropDialog', () => {
  it('opens on the whole picture, then picks a shape and moves and resizes with the keyboard', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Crop picture' })).toBeInTheDocument();
    expect(apply()).toBeDisabled(); // until the picture has loaded
    act(() => loadPicture(picture(), { width: 400, height: 300 }, { width: 800, height: 600 }));
    expect(apply()).toBeEnabled();
    expect(result()).toBe('The cropped picture will be 800 × 600 pixels.');

    const square = screen.getByRole('button', { name: 'Square' });
    fireEvent.click(square);
    expect(square).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Free' })).toHaveAttribute('aria-pressed', 'false');
    expect(result()).toBe('The cropped picture will be 600 × 600 pixels.');

    const area = screen.getByRole('button', { name: 'Crop area' });
    expect(area).toHaveAccessibleDescription(/arrow keys move the box/);
    const before = area.style.left;
    fireEvent.keyDown(area, { key: 'ArrowLeft' });
    expect(area.style.left).not.toBe(before);
    expect(result()).toBe('The cropped picture will be 600 × 600 pixels.');
    fireEvent.keyDown(area, { key: 'ArrowLeft', shiftKey: true });
    expect(result()).toBe('The cropped picture will be 588 × 588 pixels.');
  });

  it('keeps a locked shape and offers no shapes to pick', () => {
    open({ aspect: '16:9' });
    act(() => loadPicture(picture(), { width: 400, height: 300 }, { width: 800, height: 600 }));
    expect(screen.queryByRole('group', { name: 'Shape' })).not.toBeInTheDocument();
    expect(result()).toBe('The cropped picture will be 800 × 450 pixels.');
  });

  it('draws the selection on a canvas, uploads it and hands back the new file', async () => {
    const canvas = fakeCanvas();
    try {
      const done = open({ aspect: '1:1' });
      act(() => loadPicture(picture(), { width: 400, height: 300 }, { width: 800, height: 600 }));
      fireEvent.click(apply());
      await waitFor(() => expect(FakeRequest.last).toBeDefined());
      expect(canvas.drawn[0]?.slice(1)).toEqual([100, 0, 600, 600, 0, 0, 600, 600]);
      expect(sent().url).toBe('/api/files?scope=learning%3Acourse_1');
      expect(sentFile().name).toBe('Cropped picture.png');
      expect(sentFile().type).toBe('image/png');
      act(() => sent().progress(1, 2));
      expect(
        (
          screen.getByRole('progressbar', {
            name: 'Saving the cropped picture',
          }) as HTMLProgressElement
        ).value,
      ).toBe(0.5);
      act(() =>
        sent().answer(201, {
          id: 'file_2',
          name: 'Cropped picture.png',
          size: 33,
          mimeType: 'image/png',
          url: '/api/files/file_2',
        }),
      );
      await waitFor(() => expect(done.cropped).toHaveLength(1));
      expect(done.cropped[0]).toEqual({
        media: { kind: 'file', fileId: 'file_2' },
        width: 600,
        height: 600,
      });
    } finally {
      canvas.restore();
    }
  });

  it('says so when the browser has no canvas, and cancels', async () => {
    const done = open();
    act(() => loadPicture(picture(), { width: 400, height: 300 }, { width: 800, height: 600 }));
    fireEvent.click(apply());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This browser can't crop the picture.",
    );
    expect(FakeRequest.last).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(done.cancelled).toBe(1);
  });

  it('says so when the picture does not load', () => {
    open();
    fireEvent.error(picture());
    expect(screen.getByRole('alert')).toHaveTextContent("This picture couldn't be loaded");
    expect(apply()).toBeDisabled();
  });
});
