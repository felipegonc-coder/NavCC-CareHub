// The conversation in the assistant panel (Claude features spec, section 3.3): each question with
// what Claude could read, and each answer drawn from its Markdown (never as HTML, and with no
// images) followed by its sources as page links, Copy and Add to page.
import {
  ASSISTANT_SCOPE_LABELS,
  ASSISTANT_TEXTS,
  type AssistantMessage,
  type AssistantPageLink,
  type AssistantScope,
} from '@carehub/extras/claude/assistant';
import { markdownToBlocks } from '@carehub/extras/claude/markdown';
import { pageUrl } from '@carehub/shared';
import { Button, Spinner, VisuallyHidden } from '@carehub/ui';
import { Check, Copy, FilePlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { NOT_ADDED } from '../write/AskClaude';
import { Preview } from '../write/Preview';
import { WRITING_TEXT } from '../write/ResultBox';
import { addToPage, pageEditor } from './page';
import type { Asking } from './useAsk';

export const ADDED = 'Added to the page.';
export const NOT_COPIED = "Couldn't copy. Select the answer and copy it instead.";
/** How long Copy says Copied. */
const COPIED_MS = 2_000;
/** Page titles a question lists before "+ n more". */
const TITLES_SHOWN = 3;

const titleOf = (page: AssistantPageLink) => page.title.trim() || 'Untitled';

export interface ConversationProps {
  messages: readonly AssistantMessage[];
  /** The question on its way, or the one that failed. */
  asking: Asking | null;
  /** The page open in the main area, for Add to page. */
  pageId: string | null;
  onRetry: () => void;
  /** A source link was followed. */
  onOpenSource: () => void;
}

export function Conversation({
  messages,
  asking,
  pageId,
  onRetry,
  onOpenSource,
}: ConversationProps) {
  const end = useRef<HTMLDivElement>(null);
  const count = messages.length;

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [count, asking]);

  if (count === 0 && !asking) {
    return <p className="px-6 py-12 text-center text-body text-muted">{ASSISTANT_TEXTS.empty}</p>;
  }
  return (
    <div className="flex flex-col p-4">
      <ol className="flex flex-col gap-4">
        {messages.map((message) => (
          <li key={message.id}>
            {message.role === 'question' ? (
              <Question text={message.text} scope={message.scope} pages={message.pages} />
            ) : (
              <Answer message={message} pageId={pageId} onOpenSource={onOpenSource} />
            )}
          </li>
        ))}
        {asking && (
          <li>
            <Question
              text={asking.request.question}
              scope={asking.request.scope}
              pages={asking.pages}
            />
          </li>
        )}
        {asking && (
          <li>
            {asking.problem ? (
              <div className="flex flex-col items-start gap-2">
                <p role="alert" className="text-small text-danger">
                  {asking.problem.message}
                </p>
                {asking.problem.canRetry && (
                  <Button variant="secondary" size="sm" onClick={onRetry}>
                    Try again
                  </Button>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-2 text-small text-muted">
                <Spinner decorative />
                {WRITING_TEXT}
              </p>
            )}
          </li>
        )}
      </ol>
      <div ref={end} />
    </div>
  );
}

interface QuestionProps {
  text: string;
  scope: AssistantScope | null;
  pages: readonly AssistantPageLink[];
}

function Question({ text, scope, pages }: QuestionProps) {
  const more = pages.length - TITLES_SHOWN;
  const about = [
    ...(scope ? [ASSISTANT_SCOPE_LABELS[scope]] : []),
    ...pages.slice(0, TITLES_SHOWN).map(titleOf),
    ...(more > 0 ? [`+ ${more} more`] : []),
  ].join(' · ');
  return (
    <div className="ml-8 flex flex-col items-end gap-1">
      <p className="max-w-full whitespace-pre-wrap break-words rounded bg-fill px-3 py-2 text-body">
        <VisuallyHidden>You asked: </VisuallyHidden>
        {text}
      </p>
      {about && <p className="max-w-full truncate text-label text-muted">{about}</p>}
    </div>
  );
}

interface AnswerProps {
  message: AssistantMessage;
  pageId: string | null;
  onOpenSource: () => void;
}

function Answer({ message, pageId, onOpenSource }: AnswerProps) {
  const blocks = useMemo(() => markdownToBlocks(message.text), [message.text]);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const editor = pageId ? pageEditor(pageId) : null;

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.text);
      setNote('');
      setCopied(true);
    } catch {
      setNote(NOT_COPIED);
    }
  };

  const add = () => {
    // Looked up again: the page may have closed or turned read-only since this drew.
    const target = pageId ? pageEditor(pageId) : null;
    setNote(target && addToPage(target, message.text) ? ADDED : NOT_ADDED);
  };

  return (
    <div className="flex flex-col gap-2">
      <VisuallyHidden>Claude:</VisuallyHidden>
      <Preview blocks={blocks} />
      {message.sources.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-label text-muted">Sources</p>
          <ul className="flex flex-col gap-1">
            {message.sources.map((source) => (
              <li key={source.id} className="min-w-0 truncate">
                <Link
                  to={pageUrl(source.id)}
                  onClick={onOpenSource}
                  className="text-small text-primary underline"
                >
                  {titleOf(source)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" onClick={() => void copy()}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
        {editor && (
          <Button variant="ghost" size="sm" onClick={add}>
            <FilePlus aria-hidden />
            Add to page
          </Button>
        )}
        <span role="status" className="text-label text-muted">
          {note}
        </span>
      </div>
    </div>
  );
}
