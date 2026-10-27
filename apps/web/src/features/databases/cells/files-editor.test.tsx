import type { FileRef } from '@carehub/databases';
import { act, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CELL_TEXT } from './messages';
import { openEditor, pressOutside, prop } from './test-helpers';

const photos = prop({ type: 'files' }, 'Photos');
const invoice: FileRef = {
  id: 'file-invoice',
  name: 'invoice.pdf',
  size: 2048,
  mime: 'application/pdf',
};
const leak: FileRef = { id: 'file-leak', name: 'leak.jpg', size: 4096, mime: 'image/jpeg' };
const linkBox = () => screen.getByRole('textbox', { name: CELL_TEXT.webLink });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const enter = (el: HTMLElement) => fireEvent.keyDown(el, { key: 'Enter' });
const picture = (name: string) => new File(['photo'], name, { type: 'image/jpeg' });
const choose = (...files: File[]) =>
  fireEvent.change(screen.getByLabelText(CELL_TEXT.upload), { target: { files } });

/** An upload the test finishes or fails when it wants. */
function controlledUpload() {
  const pending: { resolve: (ref: FileRef) => void; reject: (e: Error) => void }[] = [];
  const onUpload = vi.fn<(file: File) => Promise<FileRef>>(
    () =>
      new Promise<FileRef>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { onUpload, pending };
}

describe('FilesEditor', () => {
  it('removes files and saves the rest', async () => {
    const { onCommit } = await openEditor({ property: photos, value: [invoice, leak] });
    expect(linkBox()).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.remove('invoice.pdf') }));
    expect(screen.queryByText('invoice.pdf')).toBeNull();
    enter(linkBox());
    expect(onCommit).toHaveBeenCalledWith([leak], { changed: true });
  });

  it('adds web links, with https:// when it is missing', async () => {
    const { onCommit } = await openEditor({ property: photos, value: [invoice] });
    type(linkBox(), 'example.com/plans.pdf');
    enter(linkBox());
    expect(screen.getByText('plans.pdf')).toBeInTheDocument();
    expect(linkBox()).toHaveValue('');
    enter(linkBox());
    const [value, details] = onCommit.mock.calls[0] ?? [];
    expect(details).toEqual({ changed: true });
    expect(value).toEqual([
      invoice,
      {
        id: value[1].id,
        name: 'plans.pdf',
        size: 0,
        mime: '',
        url: 'https://example.com/plans.pdf',
      },
    ]);
  });

  it('adds a typed link when saving, and refuses one that isn’t a web address', async () => {
    const { onCommit } = await openEditor({ property: photos, value: null });
    type(linkBox(), 'not a link');
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.addLink }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a web address.');
    type(linkBox(), 'https://example.com/plans.pdf');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.keyDown(linkBox(), { key: 'Tab' });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: CELL_TEXT.addLink }), { key: 'Tab' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[1]).toEqual({ changed: true, move: 'next' });
  });

  it('uploads chosen files and waits for them before saving', async () => {
    const { onUpload, pending } = controlledUpload();
    const { onCommit } = await openEditor({ property: photos, value: null, onUpload });
    expect(screen.getByRole('button', { name: CELL_TEXT.upload })).toHaveFocus();
    choose(picture('sink.jpg'));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(CELL_TEXT.uploading);
    enter(linkBox());
    pressOutside();
    expect(onCommit).not.toHaveBeenCalled();
    const sink: FileRef = { id: 'file-sink', name: 'sink.jpg', size: 5, mime: 'image/jpeg' };
    await act(async () => pending[0]?.resolve(sink));
    expect(screen.queryByRole('status')).toBeNull();
    enter(linkBox());
    expect(onCommit).toHaveBeenCalledWith([sink], { changed: true });
  });

  it('offers Retry when an upload fails, and leaves failed ones out', async () => {
    const { onUpload, pending } = controlledUpload();
    const { onCommit } = await openEditor({ property: photos, value: [invoice], onUpload });
    choose(picture('sink.jpg'));
    await act(async () => pending[0]?.reject(new Error('Offline')));
    expect(screen.getByText(`· ${CELL_TEXT.uploadFailed}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.retry }));
    expect(onUpload).toHaveBeenCalledTimes(2);
    await act(async () => pending[1]?.reject(new Error('Offline')));
    enter(linkBox());
    expect(onCommit).toHaveBeenCalledWith([invoice], { changed: false });
  });

  it('takes up to 20 files', async () => {
    const many = Array.from({ length: 19 }, (_, i) => ({ ...invoice, id: `file-${i}` }));
    const { onUpload } = controlledUpload();
    await openEditor({ property: photos, value: many, onUpload });
    choose(picture('one.jpg'), picture('two.jpg'));
    expect(screen.getByRole('alert')).toHaveTextContent('Up to 20 files.');
    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('leaves on Escape and saves on a press outside, without a link that isn’t valid', async () => {
    const escaped = await openEditor({ property: photos, value: [invoice] });
    fireEvent.keyDown(linkBox(), { key: 'Escape' });
    expect(escaped.onCancel).toHaveBeenCalledTimes(1);
    escaped.unmount();
    const outside = await openEditor({ property: photos, value: [invoice, leak] });
    fireEvent.click(screen.getByRole('button', { name: CELL_TEXT.remove('leak.jpg') }));
    type(linkBox(), 'not a link');
    pressOutside();
    expect(outside.onCommit).toHaveBeenCalledWith([invoice], { changed: true });
  });
});
