import { markdownToBlocks } from '@carehub/extras/claude/markdown';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CHANGED_NOTE,
  resultAnnouncement,
  ResultBox,
  type ResultBoxProps,
  type WriteResult,
} from './ResultBox';

const answer = markdownToBlocks('Call Jordan **before** the visit.\n\n- Bring the forms');

function box(result: WriteResult, props: Partial<ResultBoxProps> = {}) {
  const handlers = {
    onStop: vi.fn(),
    onReplace: vi.fn(),
    onInsertBelow: vi.fn(),
    onTryAgain: vi.fn(),
    onDiscard: vi.fn(),
  };
  const view = render(
    <ResultBox
      title="Make shorter"
      result={result}
      canReplace
      changed={false}
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, ...view };
}

const button = (name: string) => screen.getByRole('button', { name });
const noButton = (name: string) => expect(screen.queryByRole('button', { name })).toBeNull();

describe('ResultBox', () => {
  it('says Claude is writing, with Stop focused and nothing to add yet', () => {
    const { onStop } = box({ status: 'writing' });
    expect(screen.getByText('Claude is writing…')).toBeInTheDocument();
    expect(button('Stop')).toHaveFocus();
    noButton('Replace');
    noButton('Insert below');
    fireEvent.click(button('Stop'));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it('previews the answer with Replace, Insert below, Try again and Discard', () => {
    const handlers = box({ status: 'done', answer });
    const preview = screen.getByRole('region', { name: "Claude's answer" });
    expect(preview).toHaveTextContent('Call Jordan before the visit.');
    expect(button('Replace')).toHaveFocus();
    fireEvent.click(button('Replace'));
    fireEvent.click(button('Insert below'));
    fireEvent.click(button('Try again'));
    fireEvent.click(button('Discard'));
    for (const handler of [
      handlers.onReplace,
      handlers.onInsertBelow,
      handlers.onTryAgain,
      handlers.onDiscard,
    ]) {
      expect(handler).toHaveBeenCalledOnce();
    }
    expect(screen.queryByText(CHANGED_NOTE)).toBeNull();
  });

  it('turns Replace into Insert below when the words changed meanwhile (CL-08)', () => {
    box({ status: 'done', answer }, { changed: true });
    noButton('Replace');
    expect(screen.getByText(CHANGED_NOTE)).toBeInTheDocument();
    expect(button('Insert below')).toHaveFocus();
  });

  it('offers only Insert below for Draft and Continue writing', () => {
    box({ status: 'done', answer }, { canReplace: false, changed: false });
    noButton('Replace');
    expect(screen.queryByText(CHANGED_NOTE)).toBeNull();
    expect(button('Insert below')).toHaveFocus();
  });

  it('shows a problem with Try again when it may help (CL-17)', () => {
    const { onTryAgain } = box({
      status: 'problem',
      problem: { message: "Claude isn't available right now.", canRetry: true },
    });
    expect(screen.getByText("Claude isn't available right now.")).toBeInTheDocument();
    expect(button('Try again')).toHaveFocus();
    fireEvent.click(button('Try again'));
    expect(onTryAgain).toHaveBeenCalledOnce();
    noButton('Replace');
  });

  it('offers only Discard when trying again would not help', () => {
    box({
      status: 'problem',
      problem: { message: 'Select less text.', canRetry: false },
    });
    noButton('Try again');
    expect(button('Discard')).toHaveFocus();
  });

  it("says why the answer didn't go in, keeping it", () => {
    box({ status: 'done', answer }, { notice: "Couldn't add that here." });
    expect(screen.getByText("Couldn't add that here.")).toBeInTheDocument();
    expect(screen.getByRole('region', { name: "Claude's answer" })).toBeInTheDocument();
  });

  it('moves focus to the answer when Claude finishes', () => {
    const view = box({ status: 'writing' });
    view.rerender(
      <ResultBox
        title="Make shorter"
        result={{ status: 'done', answer }}
        canReplace
        changed={false}
        onStop={view.onStop}
        onReplace={view.onReplace}
        onInsertBelow={view.onInsertBelow}
        onTryAgain={view.onTryAgain}
        onDiscard={view.onDiscard}
      />,
    );
    expect(button('Replace')).toHaveFocus();
  });
});

describe('resultAnnouncement', () => {
  it('says Claude is writing, then the finished answer or the problem', () => {
    expect(resultAnnouncement(null)).toBe('');
    expect(resultAnnouncement({ status: 'writing' })).toBe('Claude is writing');
    expect(resultAnnouncement({ status: 'done', answer })).toBe(
      'Call Jordan before the visit.\nBring the forms',
    );
    expect(
      resultAnnouncement({ status: 'problem', problem: { message: 'Nope.', canRetry: false } }),
    ).toBe('Nope.');
  });
});
