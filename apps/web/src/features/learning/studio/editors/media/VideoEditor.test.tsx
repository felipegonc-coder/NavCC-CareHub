import { type VideoBlock } from '@carehub/learning';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeFetch, fakeRequests, fileInput, sent } from '../../../media/testing';
import { renderEditor } from './testing';
import { VideoEditor } from './VideoEditor';

// Fictional content only.
const block: VideoBlock = {
  id: 'block_1',
  type: 'video',
  media: { kind: 'file', fileId: 'file_1' },
  title: 'Putting on gloves',
  captions: [{ fileId: 'file_2', language: 'en' }],
};
const VTT = 'WEBVTT\n\n00:00.000 --> 00:02.000\n<v Ana>Wash your hands first.\n';
const captionsFile = (n: number) =>
  within(screen.getByRole('group', { name: `Captions file ${n}` }));
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

let restore = () => {};
beforeEach(() => {
  restore = fakeRequests();
});
afterEach(() => restore());

describe('VideoEditor', () => {
  it('says what the video plays, and edits its title', () => {
    const { latest } = renderEditor(VideoEditor, block);
    expect(screen.getByText('Plays the uploaded video.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
      target: { value: 'Gloves, step by step' },
    });
    expect(latest().title).toBe('Gloves, step by step');
  });

  it('has no captions files for videos from other sites, and says why a link cannot play', () => {
    renderEditor(VideoEditor, {
      ...block,
      media: { kind: 'url', url: 'https://youtu.be/dQw4w9WgXcQ' },
    });
    expect(screen.getByText('Plays from YouTube.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Captions' })).toBeNull();
    expect(
      screen.getByText('Videos from other sites show their own captions.'),
    ).toBeInTheDocument();
    restore();
    restore = fakeRequests();
  });

  it('refuses a link to a video file on another site', () => {
    renderEditor(VideoEditor, {
      ...block,
      media: { kind: 'url', url: 'https://cdn.example.test/a.mp4' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('upload it here');
  });

  it('keeps a captions language only once it is a language tag', () => {
    const { latest, changes } = renderEditor(VideoEditor, block);
    const language = captionsFile(1).getByRole('textbox', { name: 'Language' });
    fireEvent.change(language, { target: { value: 'spanish!' } });
    expect(language).toHaveAccessibleDescription(/Use a language tag/);
    expect(changes).toHaveLength(0);
    fireEvent.change(language, { target: { value: 'es-MX' } });
    fireEvent.change(captionsFile(1).getByRole('textbox', { name: 'Name in the menu' }), {
      target: { value: 'Español' },
    });
    expect(latest().captions).toEqual([{ fileId: 'file_2', language: 'es-MX', label: 'Español' }]);
    click('Remove captions file 1');
    expect(latest()).not.toHaveProperty('captions');
  });

  it('adds an uploaded captions file, in English to start with', async () => {
    const { latest } = renderEditor(VideoEditor, { ...block, captions: undefined });
    const vtt = new File([VTT], 'gloves.vtt', { type: 'text/vtt' });
    const captions = screen.getByRole('group', { name: 'Captions' });
    fireEvent.change(fileInput(captions), { target: { files: [vtt] } });
    await waitFor(() => expect(sent().url).toContain('/api/files'));
    act(() =>
      sent().answer(201, {
        id: 'file_9',
        name: 'gloves.vtt',
        size: vtt.size,
        mimeType: 'text/vtt',
        url: '/api/files/file_9',
      }),
    );
    await waitFor(() => expect(latest().captions).toEqual([{ fileId: 'file_9', language: 'en' }]));
  });

  it('uses a captions file as the transcript', async () => {
    const calls = fakeFetch();
    try {
      const { latest } = renderEditor(VideoEditor, block);
      click('Use as the transcript');
      expect(calls.calls[0]?.url).toBe('/api/files/file_2');
      expect(screen.getByRole('button', { name: 'Loading the captions…' })).toBeDisabled();
      await act(async () => calls.calls[0]?.answer(200, VTT));
      await waitFor(() => expect(latest().transcript).toBeDefined());
      expect(latest().transcript).toEqual([
        { runs: [{ text: 'Ana: ', marks: ['bold'] }, { text: 'Wash your hands first.' }] },
      ]);
      expect(screen.getByRole('status')).toHaveTextContent(
        "The transcript now has the captions' text.",
      );
    } finally {
      calls.restore();
    }
  });

  it('says when a captions file cannot be loaded', async () => {
    const calls = fakeFetch();
    try {
      const { changes } = renderEditor(VideoEditor, block);
      click('Use as the transcript');
      await act(async () => calls.calls[0]?.answer(404, 'Not found'));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent("The captions couldn't be loaded."),
      );
      expect(changes).toHaveLength(0);
    } finally {
      calls.restore();
    }
  });
});
