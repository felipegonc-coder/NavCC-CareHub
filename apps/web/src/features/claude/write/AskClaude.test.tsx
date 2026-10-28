import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api';
import { UNAVAILABLE, WriteStopped } from './api';
import { AskClaude, type AskClaudeProps } from './AskClaude';
import { openAskClaude } from './open';
import { CHANGED_NOTE } from './ResultBox';
import { setWritingHelpOn } from './status';
import { doc, fakeEditor, p } from './test-page';

const PAGE = '6f1c2b8a-3d4e-4f5a-9b6c-7d8e9f0a1b2c';

type Ask = NonNullable<AskClaudeProps['ask']>;

interface Call {
  input: Parameters<Ask>[0];
  signal: AbortSignal | undefined;
  answer: (text: string) => Promise<void>;
  fail: (error: unknown) => Promise<void>;
}

/** Claude, answering when the test says so. */
function claude() {
  const calls: Call[] = [];
  const ask = vi.fn<Ask>(
    (input, options) =>
      new Promise<string>((resolve, reject) => {
        const signal = options?.signal;
        signal?.addEventListener('abort', () => reject(new WriteStopped('Stopped')));
        calls.push({
          input,
          signal,
          answer: (text) => act(async () => resolve(text)),
          fail: (error) => act(async () => reject(error)),
        });
      }),
  );
  return { ask, calls };
}

// <p>Refunds take five days.</p><p>Ask Sam first.</p>, with the first sentence selected.
function setUp(
  selection = { from: 1, to: 24 },
  page = doc(p('Refunds take five days.'), p('Ask Sam first.')),
) {
  const holder = document.createElement('div');
  holder.dataset.pageId = PAGE;
  const dom = document.createElement('div');
  holder.append(dom);
  document.body.append(holder);
  const fake = fakeEditor(page, selection, dom);
  const { ask, calls } = claude();
  const report = vi.fn<NonNullable<AskClaudeProps['report']>>(async () => undefined);
  render(<AskClaude ask={ask} report={report} />);
  act(() => {
    openAskClaude(fake.editor);
  });
  return { ...fake, ask, calls, report };
}

const item = (name: string) => screen.getByRole('menuitem', { name });
const button = (name: string) => screen.getByRole('button', { name });
const announced = () => screen.getByRole('status');

describe('Ask Claude', () => {
  beforeEach(() => setWritingHelpOn(true));
  afterEach(() => setWritingHelpOn(false));

  it('opens a menu of the 8 actions, with the first one focused', () => {
    setUp();
    const menu = screen.getByRole('menu', { name: 'Ask Claude' });
    const names = within(menu)
      .getAllByRole('menuitem')
      .map((entry) => entry.firstChild?.textContent);
    expect(names).toEqual([
      'Improve writing',
      'Fix grammar',
      'Change tone',
      'Make shorter',
      'Simplify',
      'Continue writing',
      'Summarize',
      'Draft',
    ]);
    expect(item('Draft')).toHaveAccessibleDescription('Type what you want');
    expect(item('Change tone')).toHaveAttribute('aria-haspopup', 'menu');
    expect(item('Improve writing')).toHaveFocus();
    fireEvent.keyDown(item('Improve writing'), { key: 'ArrowDown' });
    expect(item('Fix grammar')).toHaveFocus();
    fireEvent.keyDown(item('Fix grammar'), { key: 'ArrowUp' });
    fireEvent.keyDown(item('Improve writing'), { key: 'ArrowUp' });
    expect(item('Draft')).toHaveFocus();
  });

  it('previews the answer and changes the page only on Replace (CL-06)', async () => {
    const { calls, inserted, report } = setUp();
    fireEvent.click(item('Make shorter'));
    expect(calls[0]?.input).toEqual({
      pageId: PAGE,
      action: 'make_shorter',
      selection: 'Refunds take five days.',
      at: 0,
    });
    expect(screen.getByText('Claude is writing…')).toBeInTheDocument();
    expect(announced()).toHaveTextContent('Claude is writing');

    await calls[0]?.answer('Refunds take **5** days.');
    const preview = screen.getByRole('region', { name: "Claude's answer" });
    expect(preview).toHaveTextContent('Refunds take 5 days.');
    expect(announced()).toHaveTextContent('Refunds take 5 days.');
    expect(inserted).toEqual([]);

    fireEvent.click(button('Replace'));
    expect(inserted).toEqual([
      [
        { from: 1, to: 24 },
        [
          { type: 'text', text: 'Refunds take ' },
          { type: 'text', text: '5', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' days.' },
        ],
      ],
    ]);
    expect(report).toHaveBeenCalledWith({
      pageId: PAGE,
      action: 'make_shorter',
      placement: 'replace',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers the 4 tones under Change tone; ← goes back', async () => {
    const { calls } = setUp();
    fireEvent.click(item('Change tone'));
    const tones = screen.getByRole('menu', { name: 'Change tone' });
    expect(
      within(tones)
        .getAllByRole('menuitem')
        .map((entry) => entry.textContent),
    ).toEqual(['Professional', 'Friendly', 'Direct', 'Empathetic']);
    expect(item('Professional')).toHaveFocus();
    fireEvent.keyDown(item('Professional'), { key: 'ArrowLeft' });
    fireEvent.keyDown(item('Improve writing'), { key: 'End' });
    fireEvent.keyDown(item('Draft'), { key: 'Home' });
    expect(item('Improve writing')).toHaveFocus();

    fireEvent.click(item('Change tone'));
    fireEvent.click(item('Friendly'));
    expect(calls[0]?.input).toMatchObject({ action: 'change_tone', tone: 'friendly' });
    expect(screen.getByText('Change tone: Friendly')).toBeInTheDocument();
  });

  it('asks what to write for Draft and puts the answer below, never replacing', async () => {
    const { calls, inserted, report } = setUp({ from: 40, to: 40 });
    fireEvent.click(item('Draft'));
    const box = screen.getByRole('textbox', { name: 'What should Claude write?' });
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(box).toHaveAccessibleDescription('Say what Claude should write.');
    expect(calls).toHaveLength(0);

    fireEvent.change(box, { target: { value: 'A welcome note for Jordan' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(calls[0]?.input).toMatchObject({ action: 'draft', prompt: 'A welcome note for Jordan' });
    await calls[0]?.answer('Welcome, Jordan!');
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    fireEvent.click(button('Insert below'));
    expect(inserted).toHaveLength(1);
    expect(report).toHaveBeenCalledWith({
      pageId: PAGE,
      action: 'draft',
      placement: 'insert_below',
    });
  });

  it('stops without a trace: Stop, Discard and Esc leave the page as it was', async () => {
    const { calls, inserted, report, viewFocused } = setUp();
    fireEvent.click(item('Improve writing'));
    fireEvent.click(button('Stop'));
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(viewFocused()).toBe(true);

    act(() => {
      openAskClaude(setUpEditorAgain());
    });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(inserted).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it('turns Replace into Insert below when the words change while Claude writes (CL-08)', async () => {
    const { calls, edit } = setUp();
    fireEvent.click(item('Improve writing'));
    // A co-editor adds "working " before "days".
    act(() => edit(doc(p('Refunds take five working days.'), p('Ask Sam first.')), 19, 8));
    await calls[0]?.answer('Refunds take five days to arrive.');
    expect(screen.queryByRole('button', { name: 'Replace' })).toBeNull();
    expect(screen.getByText(CHANGED_NOTE)).toBeInTheDocument();
    expect(button('Insert below')).toHaveFocus();
  });

  it("shows when Claude isn't available, and tries again (CL-17)", async () => {
    const { calls } = setUp();
    fireEvent.click(item('Simplify'));
    await calls[0]?.fail(new ApiError(0, 'timeout', UNAVAILABLE));
    expect(announced()).toHaveTextContent(UNAVAILABLE);
    fireEvent.click(button('Try again'));
    expect(calls).toHaveLength(2);
    expect(calls[1]?.input).toEqual(calls[0]?.input);
    await calls[1]?.answer('Refunds take five days.');
    expect(screen.getByRole('region', { name: "Claude's answer" })).toBeInTheDocument();
  });

  it('asks for a selection before rewriting an empty line', () => {
    const { calls } = setUp({ from: 1, to: 1 }, doc(p()));
    fireEvent.click(item('Improve writing'));
    expect(calls).toHaveLength(0);
    expect(screen.getByRole('dialog')).toHaveTextContent('Select some text first.');
    expect(announced()).toHaveTextContent('Select some text first.');
  });

  it('closes and stops its request when writing help is switched off (CL-05)', () => {
    const { calls } = setUp();
    fireEvent.click(item('Fix grammar'));
    act(() => setWritingHelpOn(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls[0]?.signal?.aborted).toBe(true);
  });
});

/** Another editor in the same page, for opening a second time. */
function setUpEditorAgain() {
  const holder = document.createElement('div');
  holder.dataset.pageId = PAGE;
  const dom = document.createElement('div');
  holder.append(dom);
  document.body.append(holder);
  return fakeEditor(doc(p('Ask Sam first.')), { from: 1, to: 15 }, dom).editor;
}
