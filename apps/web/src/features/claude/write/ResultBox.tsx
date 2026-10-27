// The box under the text where Claude's answer appears (Claude features spec, section 3.2):
// "Claude is writing…" with Stop, then the answer with Replace, Insert below, Try again and
// Discard. The page changes only on Replace or Insert below (CL-06). When the words changed
// while Claude wrote, Replace gives way to Insert below with a note (CL-08); a problem shows its
// words with Try again when that may help (CL-16, CL-17).
import { blocksText, type ClaudeBlock } from '@carehub/extras/claude/markdown';
import { Button, Spinner } from '@carehub/ui';
import { useEffect, useRef } from 'react';
import type { WriteProblem } from './api';
import { Preview } from './Preview';

export type WriteResult =
  | { status: 'writing' }
  | { status: 'done'; answer: ClaudeBlock[] }
  | { status: 'problem'; problem: WriteProblem };

export const WRITING_TEXT = 'Claude is writing…';
export const CHANGED_NOTE = 'The text changed while Claude was writing.';

/**
 * What screen readers hear, in a live region that stays on the page (section 4): "Claude is
 * writing", then the finished answer once, never each word.
 */
export function resultAnnouncement(result: WriteResult | null): string {
  if (!result) return '';
  if (result.status === 'writing') return 'Claude is writing';
  if (result.status === 'problem') return result.problem.message;
  return blocksText(result.answer);
}

export interface ResultBoxProps {
  /** The action as the menu names it, such as "Make shorter" or "Change tone: Friendly". */
  title: string;
  result: WriteResult;
  /** The action rewrites selected words, so Replace can swap them. */
  canReplace: boolean;
  /** Those words changed while Claude was writing. */
  changed: boolean;
  onStop: () => void;
  onReplace: () => void;
  onInsertBelow: () => void;
  onTryAgain: () => void;
  onDiscard: () => void;
}

export function ResultBox({
  title,
  result,
  canReplace,
  changed,
  onStop,
  onReplace,
  onInsertBelow,
  onTryAgain,
  onDiscard,
}: ResultBoxProps) {
  const first = useRef<HTMLButtonElement>(null);
  const showReplace = canReplace && !changed;
  const retry = result.status === 'problem' ? result.problem.canRetry : true;

  // Keyboard focus follows the box: Stop while Claude writes, then the main choice.
  useEffect(() => {
    first.current?.focus();
  }, [result.status, showReplace, retry]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-label font-medium text-muted">
        <span aria-hidden>✨ </span>
        {title}
      </p>
      {result.status === 'writing' && (
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-small text-muted">
            <Spinner decorative />
            {WRITING_TEXT}
          </p>
          <Button ref={first} variant="secondary" size="sm" onClick={onStop}>
            Stop
          </Button>
        </div>
      )}
      {result.status === 'problem' && (
        <>
          <p className="text-small text-fg">{result.problem.message}</p>
          <div className="flex flex-wrap gap-2">
            {retry && (
              <Button ref={first} size="sm" onClick={onTryAgain}>
                Try again
              </Button>
            )}
            <Button
              ref={retry ? undefined : first}
              variant="secondary"
              size="sm"
              onClick={onDiscard}
            >
              Discard
            </Button>
          </div>
        </>
      )}
      {result.status === 'done' && (
        <>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a long answer scrolls, and keyboard users must be able to scroll it */}
          <div
            role="region"
            aria-label="Claude's answer"
            tabIndex={0}
            className="max-h-80 overflow-y-auto rounded-sm border border-border p-3"
          >
            <Preview blocks={result.answer} />
          </div>
          {canReplace && changed && <p className="text-small text-muted">{CHANGED_NOTE}</p>}
          <div className="flex flex-wrap gap-2">
            {showReplace && (
              <Button ref={first} size="sm" onClick={onReplace}>
                Replace
              </Button>
            )}
            <Button
              ref={showReplace ? undefined : first}
              variant={showReplace ? 'secondary' : 'primary'}
              size="sm"
              onClick={onInsertBelow}
            >
              Insert below
            </Button>
            <Button variant="ghost" size="sm" onClick={onTryAgain}>
              Try again
            </Button>
            <Button variant="ghost" size="sm" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
