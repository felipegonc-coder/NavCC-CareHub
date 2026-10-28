import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RichText } from '@carehub/databases';
import { RichTextField, type RichTextFieldProps } from './rich-editor';
import { writeSelection } from './rich-dom';
import { stubResizeObserver } from './test-utils';

beforeEach(() => {
  stubResizeObserver();
});

const CALL: RichText = [{ text: 'Call Blue Pine today' }];

function setup(value: RichText = CALL, props: Partial<RichTextFieldProps> = {}) {
  const onCommit = vi.fn();
  const view = render(
    <RichTextField
      aria-label="Description"
      placeholder="Description"
      maxLength={60}
      value={value}
      onCommit={onCommit}
      {...props}
    />,
  );
  const box = screen.getByRole('textbox', { name: 'Description' });
  return { box, onCommit, view };
}

/** Focuses the editor and selects characters start to end, as a person would. */
function select(box: HTMLElement, start: number, end = start) {
  act(() => {
    box.focus();
    writeSelection(box, { start, end });
    document.dispatchEvent(new Event('selectionchange'));
  });
}

/** What the browser does when someone types: the page changes, then an input event. */
function typeOver(box: HTMLElement, text: string) {
  act(() => {
    box.textContent = text;
    writeSelection(box, { start: text.length, end: text.length });
  });
  fireEvent.input(box);
}

function beforeInput(box: HTMLElement, inputType: string, data: string | null = null) {
  const event = new Event('beforeinput', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'inputType', { value: inputType });
  Object.defineProperty(event, 'data', { value: data });
  Object.defineProperty(event, 'isComposing', { value: false });
  act(() => {
    box.dispatchEvent(event);
  });
  return event;
}

function leave(box: HTMLElement) {
  act(() => box.blur());
}

function openColors() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Color' }), { key: 'Enter' });
}

describe('RichTextField', () => {
  it('shows the saved formatting, and the placeholder only when empty', () => {
    setup([{ text: 'Avery', marks: ['bold'] }]);
    expect(screen.getByText('Avery').tagName).toBe('STRONG');
    expect(screen.queryByText('Description')).toBeNull();
  });

  it('shows the placeholder for empty text and hides the toolbar until it has focus', () => {
    const { box } = setup([]);
    expect(screen.getByText('Description')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('toolbar')).toBeNull();
    select(box, 0);
    expect(screen.getByRole('toolbar', { name: 'Formatting' })).toBeInTheDocument();
  });

  it('saves what was typed when focus leaves', () => {
    const { box, onCommit } = setup([]);
    select(box, 0);
    typeOver(box, 'Hello there');
    expect(screen.queryByText('Description')).toBeNull();
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([{ text: 'Hello there' }]);
  });

  it('saves nothing when the text is unchanged', () => {
    const { box, onCommit } = setup();
    select(box, 2);
    leave(box);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('applies bold, italic and underline from the toolbar and the shortcuts', () => {
    const { box, onCommit } = setup();
    select(box, 5, 14);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(box, { key: 'i', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'u', metaKey: true });
    expect(box.querySelector('u em strong')?.textContent).toBe('Blue Pine');
    expect(screen.getByRole('button', { name: 'Italic' })).toHaveAttribute('aria-pressed', 'true');
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([
      { text: 'Call ' },
      { text: 'Blue Pine', marks: ['bold', 'italic', 'underline'] },
      { text: ' today' },
    ]);
  });

  it('with nothing selected, bold applies to what is typed next', () => {
    const { box, onCommit } = setup();
    select(box, 4);
    fireEvent.keyDown(box, { key: 'b', ctrlKey: true });
    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
    expect(beforeInput(box, 'insertText', '!').defaultPrevented).toBe(true);
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([
      { text: 'Call' },
      { text: '!', marks: ['bold'] },
      { text: ' Blue Pine today' },
    ]);
  });

  it('turns the browser’s own formatting commands into ours and refuses the rest', () => {
    const { box, onCommit } = setup();
    select(box, 0, 4);
    expect(beforeInput(box, 'formatItalic').defaultPrevented).toBe(true);
    expect(beforeInput(box, 'formatFontColor').defaultPrevented).toBe(true);
    expect(beforeInput(box, 'insertUnorderedList').defaultPrevented).toBe(true);
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([
      { text: 'Call', marks: ['italic'] },
      { text: ' Blue Pine today' },
    ]);
  });

  it('Enter adds a line break', () => {
    const { box, onCommit } = setup();
    select(box, 20);
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box.lastChild?.nodeName).toBe('BR');
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([{ text: 'Call Blue Pine today\n' }]);
  });

  it('colours text and backgrounds from the Color menu, and Default takes it off', async () => {
    const { box, onCommit } = setup();
    select(box, 5, 14);
    openColors();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Red' }));
    expect(box.querySelector('[data-color="red"]')?.textContent).toBe('Blue Pine');
    await waitFor(() => expect(box).toHaveFocus());
    select(box, 0, 4);
    openColors();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Blue background' }));
    await waitFor(() => expect(box).toHaveFocus());
    select(box, 5, 14);
    openColors();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Default' }));
    await waitFor(() => expect(box).toHaveFocus());
    leave(box);
    expect(onCommit).toHaveBeenLastCalledWith([
      { text: 'Call', color: 'blue_background' },
      { text: ' Blue Pine today' },
    ]);
  });

  it('adds a link, refusing anything but a web address, and removes it', async () => {
    const { box, onCommit } = setup();
    select(box, 5, 14);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    const address = await screen.findByLabelText('Web address');
    fireEvent.change(address, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Enter a web address.')).toBeInTheDocument();
    expect(address).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(address, { target: { value: 'bluepine.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const link = box.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://bluepine.example');
    expect(link?.textContent).toBe('Blue Pine');
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.queryByLabelText('Web address')).toBeNull();
    leave(box);
    expect(onCommit).toHaveBeenLastCalledWith([
      { text: 'Call ' },
      { text: 'Blue Pine', link: 'https://bluepine.example' },
      { text: ' today' },
    ]);

    select(box, 8);
    fireEvent.keyDown(box, { key: 'k', ctrlKey: true });
    expect(await screen.findByLabelText('Web address')).toHaveValue('https://bluepine.example');
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    expect(box.querySelector('a')).toBeNull();
    await waitFor(() => expect(box).toHaveFocus());
  });

  it('pastes bold, italic and underline but no other formatting, cut to the room left', () => {
    const { box, onCommit } = setup([{ text: 'Note: ' }], { maxLength: 30 });
    select(box, 6);
    const html =
      '<h2 style="color: rgb(200, 0, 0); font-size: 24px">Heading</h2><p><b>Bold</b> <s>gone</s> and a long tail of text</p>';
    fireEvent.paste(box, {
      clipboardData: { getData: (type: string) => (type === 'text/html' ? html : 'plain') },
    });
    expect(box.querySelector('h2, s')).toBeNull();
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([
      { text: 'Note: Heading\n' },
      { text: 'Bold', marks: ['bold'] },
      { text: ' gone and a ' },
    ]);
  });

  it('pastes plain text when there is no HTML', () => {
    const { box, onCommit } = setup([]);
    select(box, 0);
    fireEvent.paste(box, {
      clipboardData: { getData: (type: string) => (type === 'text/plain' ? 'One\r\nTwo' : '') },
    });
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([{ text: 'One\nTwo' }]);
  });

  it('cuts typing back to the limit', () => {
    const { box, onCommit } = setup([], { maxLength: 10 });
    select(box, 0);
    typeOver(box, 'abcdefghijkl');
    expect(box.textContent).toBe('abcdefghij');
    leave(box);
    expect(onCommit).toHaveBeenCalledWith([{ text: 'abcdefghij' }]);
  });

  it('undoes and redoes formatting', () => {
    const { box } = setup();
    select(box, 5, 14);
    fireEvent.keyDown(box, { key: 'b', ctrlKey: true });
    expect(box.querySelector('strong')).not.toBeNull();
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true });
    expect(box.querySelector('strong')).toBeNull();
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(box.querySelector('strong')?.textContent).toBe('Blue Pine');
    expect(beforeInput(box, 'historyUndo').defaultPrevented).toBe(true);
    expect(box.querySelector('strong')).toBeNull();
  });

  it('shows a new saved value', () => {
    const { box, view } = setup();
    view.rerender(
      <RichTextField
        aria-label="Description"
        maxLength={60}
        value={[{ text: 'Thanks, Jordan', marks: ['italic'] }]}
        onCommit={vi.fn()}
      />,
    );
    expect(box.querySelector('em')?.textContent).toBe('Thanks, Jordan');
  });

  it('passes other keys on and ignores drops', () => {
    const onKeyDown = vi.fn();
    const { box } = setup(CALL, { onKeyDown });
    fireEvent.keyDown(box, { key: 'ArrowUp', altKey: true });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(fireEvent.drop(box)).toBe(false);
  });

  it('moves between toolbar buttons with the arrow keys, one Tab stop for all; Escape goes back to the text', () => {
    const { box } = setup();
    select(box, 0);
    const bold = screen.getByRole('button', { name: 'Bold' });
    const italic = screen.getByRole('button', { name: 'Italic' });
    expect(bold).toHaveAttribute('tabindex', '0');
    expect(italic).toHaveAttribute('tabindex', '-1');
    act(() => bold.focus());
    fireEvent.keyDown(bold, { key: 'ArrowRight' });
    expect(italic).toHaveFocus();
    expect(italic).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(italic, { key: 'End' });
    const color = screen.getByRole('button', { name: 'Color' });
    expect(color).toHaveFocus();
    fireEvent.keyDown(color, { key: 'Escape' });
    expect(box).toHaveFocus();
  });
});
