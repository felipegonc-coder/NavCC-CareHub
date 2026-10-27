import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaPicker, type PickedMedia } from './MediaPicker';
import {
  FakeRequest,
  fakeFetch,
  fakeRequests,
  fileInput,
  pngFile,
  sent,
  sentFile,
} from './testing';

let restore = () => {};
beforeEach(() => {
  restore = fakeRequests();
});
afterEach(() => restore());

const uploaded = {
  id: 'file_1',
  name: 'Ward map.png',
  size: 33,
  mimeType: 'image/png',
  url: '/api/files/file_1',
  width: 40,
  height: 30,
};

describe('MediaPicker', () => {
  it('says what it takes, then checks, uploads and hands over a chosen picture', async () => {
    const picks: PickedMedia[] = [];
    const { container } = render(
      <MediaPicker accept={['image']} courseId="course_1" onPick={(p) => picks.push(p)} />,
    );
    expect(screen.getByText('Drop a picture here, or')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toHaveAccessibleDescription(
      'PNG, JPEG, GIF or WebP, up to 10 MB.',
    );
    expect(fileInput(container)).toHaveAttribute(
      'accept',
      'image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp',
    );

    fireEvent.change(fileInput(container), {
      target: { files: [pngFile('Ward map.png', 40, 30)] },
    });
    await waitFor(() => expect(FakeRequest.last).toBeDefined());
    expect(sent().url).toBe('/api/files?scope=learning%3Acourse_1');
    act(() => sent().progress(50, 100));
    const bar = screen.getByRole('progressbar', { name: 'Uploading Ward map.png' });
    expect((bar as HTMLProgressElement).value).toBe(0.5);

    act(() => sent().answer(201, uploaded));
    await waitFor(() => expect(picks).toHaveLength(1));
    expect(picks[0]).toEqual({
      media: { kind: 'file', fileId: 'file_1' },
      kind: 'image',
      name: 'Ward map.png',
      size: 33,
      width: 40,
      height: 30,
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose a file' })).toBeEnabled();
  });

  it("explains why it can't take a file, without uploading it", async () => {
    const { container } = render(
      <MediaPicker accept={['image']} courseId="course_1" onPick={() => {}} />,
    );
    fireEvent.change(fileInput(container), {
      target: { files: [new File(['%PDF-1.7'], 'notes.pdf')] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This PDF document can't be used here. Choose a picture (PNG, JPEG, GIF or WebP).",
    );
    expect(FakeRequest.last).toBeUndefined();
  });

  it("shows the server's reason when the upload is refused", async () => {
    const picks: PickedMedia[] = [];
    const { container } = render(
      <MediaPicker accept={['image']} courseId="course_1" onPick={(p) => picks.push(p)} />,
    );
    fireEvent.change(fileInput(container), { target: { files: [pngFile('map.png', 4, 4)] } });
    await waitFor(() => expect(FakeRequest.last).toBeDefined());
    const message = "You can't add files to this course.";
    act(() => sent().answer(403, { error: { code: 'forbidden', message } }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(picks).toEqual([]);
  });

  it('stops the upload when asked', async () => {
    const picks: PickedMedia[] = [];
    const { container } = render(
      <MediaPicker accept={['image']} courseId="course_1" onPick={(p) => picks.push(p)} />,
    );
    fireEvent.change(fileInput(container), { target: { files: [pngFile('map.png', 4, 4)] } });
    await waitFor(() => expect(FakeRequest.last).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel upload' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Choose a file' })).toBeEnabled(),
    );
    expect(sent().aborted).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(picks).toEqual([]);
  });

  it('takes a dropped file', async () => {
    render(<MediaPicker accept={['image']} courseId="course_1" onPick={() => {}} />);
    const zone = screen.getByText('Drop a picture here, or').parentElement;
    if (!zone) throw new Error('No drop zone.');
    fireEvent.drop(zone, { dataTransfer: { files: [pngFile('map.png', 4, 4)] } });
    await waitFor(() => expect(FakeRequest.last).toBeDefined());
    expect(sentFile().name).toBe('map.png');
  });

  it('needs a course before it can upload', () => {
    render(<MediaPicker accept={['video', 'audio']} onPick={() => {}} />);
    expect(screen.getByText('Drop a video or an audio file here, or')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Choose a file' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('Save the course before adding files.');
  });

  it('takes a video link it can play and explains links it cannot', () => {
    const picks: PickedMedia[] = [];
    render(
      <MediaPicker
        accept={['video']}
        courseId="course_1"
        allowLink
        onPick={(p) => picks.push(p)}
      />,
    );
    const box = screen.getByLabelText('Or paste a link');
    fireEvent.change(box, { target: { value: 'https://example.com/page' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use link' }));
    expect(screen.getByText(/^This link isn't a video Care Hub can play\./)).toBeInTheDocument();
    expect(box).toBeInvalid();
    fireEvent.change(box, { target: { value: 'https://media.example.org/tour.mp4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use link' }));
    expect(
      screen.getByText(
        "Care Hub can't play video files from other sites. Download the video, then upload it here.",
      ),
    ).toBeInTheDocument();
    expect(picks).toEqual([]);

    fireEvent.change(box, { target: { value: ' https://youtu.be/dQw4w9WgXcQ ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(picks).toEqual([
      {
        media: { kind: 'url', url: 'https://youtu.be/dQw4w9WgXcQ' },
        kind: 'video',
        name: 'https://youtu.be/dQw4w9WgXcQ',
      },
    ]);
    expect(box).toHaveValue('');
    expect(box).toBeValid();
  });

  it('copies an https picture link into the course files', async () => {
    const fetches = fakeFetch();
    try {
      const picks: PickedMedia[] = [];
      render(
        <MediaPicker
          accept={['image']}
          courseId="course_1"
          allowLink
          onPick={(p) => picks.push(p)}
        />,
      );
      const box = screen.getByLabelText('Or paste a link');
      fireEvent.change(box, { target: { value: 'http://example.org/map.png' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use link' }));
      expect(screen.getByText('Paste a full link that starts with https://.')).toBeInTheDocument();
      expect(fetches.calls).toHaveLength(0);

      fireEvent.change(box, { target: { value: 'https://example.org/map.png' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use link' }));
      expect(screen.getByRole('progressbar', { name: 'Copying the picture' })).toBeInTheDocument();
      expect(JSON.parse(String(fetches.calls[0]?.init?.body))).toEqual({
        url: 'https://example.org/map.png',
        scope: 'learning:course_1',
      });
      act(() => fetches.calls[0]?.answer(201, uploaded));
      await waitFor(() => expect(picks).toHaveLength(1));
      expect(picks[0]).toEqual({
        media: { kind: 'file', fileId: 'file_1' },
        kind: 'image',
        name: 'Ward map.png',
        size: 33,
        width: 40,
        height: 30,
      });
      expect(box).toHaveValue('');
    } finally {
      fetches.restore();
    }
  });

  it("says why a picture link couldn't be copied", async () => {
    const fetches = fakeFetch();
    try {
      render(<MediaPicker accept={['image']} courseId="course_1" allowLink onPick={() => {}} />);
      const box = screen.getByLabelText('Or paste a link');
      fireEvent.change(box, { target: { value: 'https://example.org/page.html' } });
      fireEvent.click(screen.getByRole('button', { name: 'Use link' }));
      const message = "That link doesn't go to a picture.";
      act(() => fetches.calls[0]?.answer(400, { error: { code: 'invalid', message } }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(box).toHaveValue('https://example.org/page.html');
      expect(box).toBeEnabled();
    } finally {
      fetches.restore();
    }
  });
});
