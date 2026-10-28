// Ask Claude ✨ (Claude features spec, section 3.2): the menu of the 8 writing actions, then the
// result box under the text. The app shell renders it once (the `claude-write` overlay); the
// toolbar, "/" and Ctrl+J open it through openAskClaude. Esc or Discard leaves the page as it was
// and nothing half-written goes in (CL-06, CL-17). Switching writing help off closes it and stops
// its request (CL-05).
import { markdownToBlocks } from '@carehub/extras/claude/markdown';
import {
  WRITE_ACTION_LABELS,
  WRITE_ACTIONS,
  WRITE_TONE_LABELS,
  WRITE_TONES,
  writeTooLong,
  type WriteAction,
  type WritePlacement,
  type WriteTone,
} from '@carehub/extras/claude/write';
import { Popover, PopoverAnchor, PopoverContent, VisuallyHidden } from '@carehub/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  askClaudeToWrite,
  reportApplied,
  tooLongMessage,
  UNAVAILABLE,
  writeProblem,
  WriteStopped,
} from './api';
import {
  applyAnswer,
  targetProblem,
  TrackedTarget,
  writeTarget,
  type PageRange,
  type WriteTarget,
} from './editor';
import { DraftForm, Menu, type Entry } from './Menu';
import { onAskClaude, onAskClaudeKey, type AskClaudeRequest, type ViewedEditor } from './open';
import { resultAnnouncement, ResultBox, type WriteResult } from './ResultBox';
import { useWritingHelpOn } from './status';

export const NOT_ADDED = "Couldn't add that here.";
const SAY_WHAT = 'Say what Claude should write.';

type View = 'menu' | 'tones' | 'draft' | 'result';

/** What an action sends besides the words: the tone, or what the person typed for Draft. */
interface Extra {
  tone?: WriteTone;
  prompt?: string;
}

interface Job {
  tracked: TrackedTarget;
  extra: Extra;
  controller: AbortController;
  /** Claude's Markdown, once it's here. */
  answer: string;
}

/** Where the words are on screen, so the box sits under them. */
function rectOf(editor: ViewedEditor, range: PageRange): DOMRect {
  try {
    const start = editor.view.coordsAtPos(range.from);
    const end = editor.view.coordsAtPos(range.to);
    const left = Math.min(start.left, end.left);
    const top = Math.min(start.top, end.top);
    const right = Math.max(start.right, end.right);
    const bottom = Math.max(start.bottom, end.bottom);
    const rect = { left, top, right, bottom, x: left, y: top, width: right - left };
    return { ...rect, height: bottom - top, toJSON: () => rect } as DOMRect;
  } catch {
    return editor.view.dom.getBoundingClientRect();
  }
}

export interface AskClaudeProps {
  /** Stand-ins for tests. */
  ask?: typeof askClaudeToWrite;
  report?: typeof reportApplied;
}

export function AskClaude({ ask = askClaudeToWrite, report = reportApplied }: AskClaudeProps) {
  const on = useWritingHelpOn();
  const [session, setSession] = useState<AskClaudeRequest | null>(null);
  const [view, setView] = useState<View>('menu');
  const [title, setTitle] = useState('');
  const [result, setResult] = useState<WriteResult | null>(null);
  const [canReplace, setCanReplace] = useState(false);
  const [changed, setChanged] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);
  const job = useRef<Job | null>(null);
  const opened = useRef<AskClaudeRequest | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const leftOutside = useRef(false);

  const stopJob = useCallback(() => {
    const current = job.current;
    job.current = null;
    current?.controller.abort();
    current?.tracked.stop();
  }, []);

  const close = useCallback(() => {
    stopJob();
    const request = opened.current;
    const focusInside = content.current?.contains(document.activeElement) ?? false;
    opened.current = null;
    setSession(null);
    setResult(null);
    setNotice(null);
    // Back to the page, unless the person went somewhere else.
    if (request && focusInside && !leftOutside.current && !request.editor.isDestroyed) {
      request.editor.view.focus();
    }
  }, [stopJob]);

  // The toolbar, "/" and Ctrl+J open it; opening again starts over.
  useEffect(
    () =>
      onAskClaude((request) => {
        stopJob();
        leftOutside.current = false;
        opened.current = request;
        setSession(request);
        setView('menu');
        setResult(null);
        setNotice(null);
      }),
    [stopJob],
  );

  useEffect(() => {
    document.addEventListener('keydown', onAskClaudeKey);
    return () => document.removeEventListener('keydown', onAskClaudeKey);
  }, []);

  // Writing help switched off: the box goes and its request stops (CL-05).
  useEffect(() => {
    if (!on) close();
  }, [on, close]);

  useEffect(() => stopJob, [stopJob]);

  // The page closed under it.
  useEffect(() => {
    if (!session) return;
    const { editor } = session;
    editor.on('destroy', close);
    return () => {
      editor.off('destroy', close);
    };
  }, [session, close]);

  // Every edit while the answer is open may change the words it would replace (CL-08).
  useEffect(() => {
    if (!session || runs === 0) return;
    const { editor } = session;
    const update = () => setChanged(job.current?.tracked.changed() ?? false);
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [session, runs]);

  const anchor = useMemo(() => {
    if (!session) return null;
    const { editor } = session;
    return {
      current: {
        contextElement: editor.view.dom,
        getBoundingClientRect: () =>
          rectOf(editor, job.current?.tracked.range ?? editor.state.selection),
      },
    };
  }, [session]);

  const start = (request: AskClaudeRequest, target: WriteTarget, extra: Extra) => {
    stopJob();
    const current: Job = {
      tracked: new TrackedTarget(request.editor, target),
      extra,
      controller: new AbortController(),
      answer: '',
    };
    job.current = current;
    setCanReplace(target.canReplace);
    setChanged(false);
    setNotice(null);
    setResult({ status: 'writing' });
    setView('result');
    setRuns((count) => count + 1);
    const input = {
      pageId: request.pageId,
      action: target.action,
      selection: target.selection,
      at: target.at,
      ...extra,
    };
    ask(input, { signal: current.controller.signal }).then(
      (text) => {
        if (job.current !== current) return;
        const answer = markdownToBlocks(text);
        current.answer = text;
        setResult(
          answer.length > 0
            ? { status: 'done', answer }
            : { status: 'problem', problem: { message: UNAVAILABLE, canRetry: true } },
        );
      },
      (error: unknown) => {
        if (job.current !== current || error instanceof WriteStopped) return;
        setResult({ status: 'problem', problem: writeProblem(error, target.action) });
      },
    );
  };

  /** The words (or the block, or the page) for `action`, or why it can't go. */
  const targetFor = (action: WriteAction): WriteTarget | null => {
    if (!session) return null;
    const { doc, selection } = session.editor.state;
    const target = writeTarget(doc, selection, action);
    const problem =
      targetProblem(target) ??
      (writeTooLong({ action, selection: target.selection }) ? tooLongMessage(action) : null);
    setNotice(problem);
    return problem ? null : target;
  };

  const pick = (action: WriteAction, tone?: WriteTone) => {
    const target = targetFor(action);
    if (!session || !target) return;
    setTitle(
      tone
        ? `${WRITE_ACTION_LABELS.change_tone}: ${WRITE_TONE_LABELS[tone]}`
        : WRITE_ACTION_LABELS[action],
    );
    start(session, target, tone ? { tone } : {});
  };

  const draft = (prompt: string) => {
    if (!session) return;
    if (!prompt.trim()) return setNotice(SAY_WHAT);
    if (writeTooLong({ action: 'draft', selection: '', prompt })) {
      return setNotice(tooLongMessage('draft'));
    }
    const { doc, selection } = session.editor.state;
    setTitle(WRITE_ACTION_LABELS.draft);
    start(session, writeTarget(doc, selection, 'draft'), { prompt });
  };

  const apply = (placement: WritePlacement) => {
    const current = job.current;
    if (!session || !current) return;
    const { action } = current.tracked.target;
    if (!applyAnswer(session.editor, current.tracked.range, current.answer, placement)) {
      setNotice(NOT_ADDED);
      return;
    }
    void report({ pageId: session.pageId, action, placement });
    close();
  };

  const tryAgain = () => {
    const current = job.current;
    if (!session || !current) return;
    const { action } = current.tracked.target;
    const target = writeTarget(session.editor.state.doc, current.tracked.range, action);
    const problem = targetProblem(target);
    if (problem) {
      setResult({ status: 'problem', problem: { message: problem, canRetry: false } });
      return;
    }
    start(session, target, current.extra);
  };

  const entries: Entry[] = WRITE_ACTIONS.map((action) => ({
    id: action,
    label: WRITE_ACTION_LABELS[action],
    ...(action === 'draft' && { hint: 'Type what you want' }),
    opens: action === 'change_tone',
    pick: () => {
      if (action === 'change_tone') {
        if (targetFor(action)) setView('tones');
      } else if (action === 'draft') {
        setNotice(null);
        setView('draft');
      } else pick(action);
    },
  }));
  const tones: Entry[] = WRITE_TONES.map((tone) => ({
    id: tone,
    label: WRITE_TONE_LABELS[tone],
    pick: () => pick('change_tone', tone),
  }));
  const backToMenu = () => {
    setNotice(null);
    setView('menu');
  };

  return (
    <>
      <VisuallyHidden role="status">
        {session ? (notice ?? resultAnnouncement(view === 'result' ? result : null)) : ''}
      </VisuallyHidden>
      {session && anchor && (
        <Popover
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
        >
          <PopoverAnchor virtualRef={anchor} />
          <PopoverContent
            ref={content}
            aria-label="Ask Claude"
            side="bottom"
            align="start"
            collisionPadding={8}
            // Each view puts focus where it belongs.
            onOpenAutoFocus={(event) => event.preventDefault()}
            onCloseAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => {
              // While Claude writes, the person (or a co-editor) may go on editing the page.
              if (view === 'result') event.preventDefault();
              else leftOutside.current = true;
            }}
            className={
              view === 'result'
                ? 'w-96 max-w-[var(--radix-popover-content-available-width)] p-3'
                : 'flex w-64 flex-col gap-1 p-1'
            }
          >
            {view === 'menu' && (
              <>
                {notice && <p className="px-2 py-1.5 text-small text-muted">{notice}</p>}
                <Menu label="Ask Claude" entries={entries} />
              </>
            )}
            {view === 'tones' && <Menu label="Change tone" entries={tones} onBack={backToMenu} />}
            {view === 'draft' && (
              <DraftForm problem={notice} onSubmit={draft} onBack={backToMenu} />
            )}
            {view === 'result' && result && (
              <ResultBox
                title={title}
                result={result}
                canReplace={canReplace}
                changed={changed}
                notice={notice}
                onStop={close}
                onReplace={() => apply('replace')}
                onInsertBelow={() => apply('insert_below')}
                onTryAgain={tryAgain}
                onDiscard={close}
              />
            )}
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
