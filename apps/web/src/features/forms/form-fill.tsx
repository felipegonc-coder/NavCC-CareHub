import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { FormDefinition, Id, RichText as RichTextValue } from '@carehub/databases';
import { DEFAULT_TIME_ZONE, isRichTextEmpty, isSafeWebLink } from '@carehub/databases';
import {
  anonymousLine,
  checkSubmission,
  draftKey,
  isAnonymousForm,
  visibleQuestions,
  type Respondent,
} from '@carehub/databases/forms';
import { validateValue } from '@carehub/databases/values';
import { Button, Logo } from '@carehub/ui';
import { isApiError, UNKNOWN_ERROR_MESSAGE } from '../databases/api';
import {
  DEFAULT_CONFIRMATION,
  problemText,
  publicCoverUrl,
  useFormsClient,
  type FillForm,
} from './api';
import {
  answerInput,
  answerInputs,
  askedQuestions,
  clearDraft,
  filesOf,
  loadDraft,
  logicValues,
  newQuestionsText,
  responseAnswers,
  saveDraft,
  uploadingText,
  type Answers,
  type AskedQuestion,
  type DraftPlace,
} from './answers';
import { Question, questionDomId } from './questions';
import { RichText } from './rich-text';

export const OFFLINE_TEXT = "You're offline. Your answers are kept here; submit when you're back.";
export const RATE_LIMITED_TEXT = 'Too many responses. Try again in a minute.';
export const REFILE_NOTE = 'The page reloaded. Add your files again.';

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** The line above the submit button: why sending failed (with Retry), or what to wait for. */
interface Notice {
  text: string;
  retry: boolean;
}

function submitProblem(error: unknown): Notice {
  if (!isApiError(error)) return { text: UNKNOWN_ERROR_MESSAGE, retry: true };
  if (error.status === 0) return { text: OFFLINE_TEXT, retry: true };
  if (error.status === 429 && error.message === UNKNOWN_ERROR_MESSAGE) {
    return { text: RATE_LIMITED_TEXT, retry: true };
  }
  return { text: error.message, retry: true };
}

/**
 * Unsent answers kept from before the page loaded. Their files went up with an earlier fill token,
 * which this fill's response can't take (decision 0010), and tokens are never kept in the browser.
 * So when the form comes with a token, those files are left out and their questions ask for them
 * again.
 */
function restoredAnswers(
  saved: Answers,
  asked: readonly AskedQuestion[],
  fill: string | undefined,
): { answers: Answers; refile: ReadonlySet<Id> } {
  const refile = new Set<Id>();
  if (!fill) return { answers: saved, refile };
  const answers = { ...saved };
  for (const q of asked) {
    if (q.kind !== 'files' || filesOf(answers[q.prop.id]).length === 0) continue;
    delete answers[q.prop.id];
    refile.add(q.prop.id);
  }
  return { answers, refile };
}

/** Moves the focus into a question's box: its first control. */
function focusQuestion(propertyId: Id): void {
  const box = document.getElementById(questionDomId(propertyId));
  box
    ?.querySelector<HTMLElement>('input:not([type="file"]), textarea, button, [role="combobox"]')
    ?.focus();
}

const confirmationOf = (def: FormDefinition): RichTextValue =>
  isRichTextEmpty(def.confirmation) ? DEFAULT_CONFIRMATION : def.confirmation;

/** An uploaded cover comes from the files API, or from the form's own link with nobody signed in. */
function coverSource(def: FormDefinition, code: string, signedOut: boolean): string | null {
  const cover = def.cover;
  if (!cover) return null;
  if (cover.url !== undefined) return isSafeWebLink(cover.url) ? cover.url : null;
  return signedOut ? publicCoverUrl(code) : `/api/files/${encodeURIComponent(cover.id)}`;
}

export interface FormFillProps {
  data: FillForm;
  /** The code in the form link, for sending the response. */
  code: string;
  /** Nobody is signed in (a form anyone can fill in): the response goes through the public route. */
  signedOut?: boolean;
  /**
   * Asks for the form again: after the server says it changed, and for a fresh fill token before
   * another response. Resolves with the form as it is now (null when it can't be filled in here
   * any more), or rejects with what went wrong.
   */
  onReload?: () => Promise<FillForm | null>;
}

/**
 * The form as a person fills it in (Forms spec, Filling in): cover, icon, title, description, the
 * questions that show for the answers so far, checks on submit, the confirmation, and a message
 * instead of the form when it can't be filled in. Unsent answers stay in the browser. A cover that
 * doesn't load is left out.
 */
export function FormFill({ data, code, signedOut = false, onReload }: FormFillProps) {
  const client = useFormsClient();
  const titleId = useId();
  const { formId, databaseId, properties, respondent, gate, form: def } = data;
  const viewer = useMemo<Respondent>(
    () => ({
      userId: respondent?.userId ?? '',
      timeZone: respondent?.timeZone ?? localTimeZone(),
    }),
    [respondent],
  );
  const key = draftKey(formId, respondent?.userId ?? null);
  const place: DraftPlace = signedOut ? 'session' : 'local';
  const asked = useMemo(() => askedQuestions(def, properties), [def, properties]);

  const [restored] = useState(() => restoredAnswers(loadDraft(key, place) ?? {}, asked, data.fill));
  const [answers, setAnswers] = useState<Answers>(restored.answers);
  const [refile, setRefile] = useState<ReadonlySet<Id>>(restored.refile);
  const [errors, setErrors] = useState<Partial<Record<Id, string>>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [uploads, setUploads] = useState<Partial<Record<Id, number>>>({});
  const [announcement, setAnnouncement] = useState('');
  const [focusTarget, setFocusTarget] = useState<{ propertyId: Id } | null>(null);
  const [brokenCover, setBrokenCover] = useState<string | null>(null);
  // The fill token (decision 0010). Uploads made so far are tied to it, and the time of the fill
  // counts from it, so a reload of the form after a change doesn't swap it; another response gets
  // a fresh one. It's only ever kept here, never in the browser's storage.
  const [fill, setFill] = useState(data.fill);
  const [starting, setStarting] = useState(false);
  const [startProblem, setStartProblem] = useState<string | null>(null);
  const sendingNow = useRef(false);
  const shownBefore = useRef<ReadonlySet<Id> | null>(null);
  const online = useOnline();

  const inputs = useMemo(
    () => answerInputs(asked, answers, viewer.timeZone),
    [asked, answers, viewer.timeZone],
  );
  const shown = useMemo(
    () => visibleQuestions(def, logicValues(asked, inputs), properties, viewer),
    [def, asked, inputs, properties, viewer],
  );
  const uploading = Object.values(uploads).reduce<number>((n, c) => n + (c ?? 0), 0);

  // Unsent answers stay in the browser (this tab only, signed out) until the response is sent.
  useEffect(() => {
    if (!sent) saveDraft(key, answers, place);
  }, [key, answers, sent, place]);

  // Questions that start to show are read out, without moving the focus.
  useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = shown;
    if (!before) return;
    const added = asked.filter((q) => shown.has(q.prop.id) && !before.has(q.prop.id));
    if (added.length > 0) setAnnouncement(newQuestionsText(added.map((q) => q.label)));
    else if ([...before].some((id) => !shown.has(id))) setAnnouncement('');
  }, [asked, shown]);

  useEffect(() => {
    if (focusTarget) focusQuestion(focusTarget.propertyId);
  }, [focusTarget]);

  const onUpdate = useCallback((propertyId: Id, change: (previous: unknown) => unknown) => {
    setAnswers((previous) => ({ ...previous, [propertyId]: change(previous[propertyId]) }));
    setErrors((previous) => {
      if (previous[propertyId] === undefined) return previous;
      const next = { ...previous };
      delete next[propertyId];
      return next;
    });
    setRefile((previous) => {
      if (!previous.has(propertyId)) return previous;
      const next = new Set(previous);
      next.delete(propertyId);
      return next;
    });
  }, []);

  const onUploads = useCallback((propertyId: Id, count: number) => {
    setUploads((previous) =>
      (previous[propertyId] ?? 0) === count ? previous : { ...previous, [propertyId]: count },
    );
  }, []);

  /** Checks one answer when the person leaves it ("Enter a number." and so on). */
  function onLeave(propertyId: Id) {
    const q = asked.find((a) => a.prop.id === propertyId);
    if (!q) return;
    const input = answerInput(q.kind, answers[propertyId], viewer.timeZone);
    if (input === null || input === false) return;
    const checked = validateValue(q.prop, input);
    if (!checked.ok) setErrors((previous) => ({ ...previous, [propertyId]: checked.error }));
  }

  async function submit() {
    if (sendingNow.current || sent) return;
    if (uploading > 0) {
      setNotice({ text: uploadingText(uploading), retry: false });
      return;
    }
    if (!online) {
      setNotice({ text: OFFLINE_TEXT, retry: false });
      return;
    }
    const anonymousForm = isAnonymousForm(def);
    const result = checkSubmission(def, properties, inputs, {
      validate: validateValue,
      respondentName: null,
      anonymous: anonymousForm,
      viewer,
    });
    if (!result.ok) {
      setErrors(result.errors);
      setSummary(result.summary);
      setNotice(null);
      const first = asked.find((q) => result.errors[q.prop.id] !== undefined);
      if (first) setFocusTarget({ propertyId: first.prop.id });
      return;
    }
    setErrors({});
    setSummary(null);
    setNotice(null);
    sendingNow.current = true;
    setSending(true);
    try {
      // anonymous: what this screen told the person. If the form stopped being anonymous since,
      // the server answers form_changed, and the reload shows the form as it is now.
      const response = { answers: responseAnswers(inputs, shown), anonymous: anonymousForm, fill };
      await (signedOut
        ? client.submitPublicResponse(code, response)
        : client.submitResponse(code, response));
      clearDraft(key, place);
      setAnswers({});
      setSent(true);
    } catch (error) {
      if (isApiError(error) && error.code === 'form_changed') void onReload?.().catch(() => null);
      setNotice(submitProblem(error));
    } finally {
      sendingNow.current = false;
      setSending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter') return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      void submit();
    } else if (event.target instanceof HTMLInputElement) {
      // Enter never sends the form from a one-line answer.
      event.preventDefault();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  async function startAgain() {
    if (onReload) {
      // Another response gets a fresh fill token: the form is fetched again first.
      setStarting(true);
      setStartProblem(null);
      try {
        const fresh = await onReload();
        if (!fresh) return;
        setFill(fresh.fill);
      } catch (error) {
        setStartProblem(problemText(error));
        return;
      } finally {
        setStarting(false);
      }
    }
    shownBefore.current = null;
    setAnswers({});
    setRefile(new Set());
    setErrors({});
    setSummary(null);
    setNotice(null);
    setSent(false);
  }

  const title = def.title.trim() || 'Untitled';
  const cover = coverSource(def, code, signedOut);
  const anonymous = anonymousLine(def);
  const failed = asked.filter((q) => errors[q.prop.id] !== undefined);
  const banner = notice ?? (online ? null : { text: OFFLINE_TEXT, retry: false });

  let body: ReactNode;
  if (gate.state !== 'open') {
    body = (
      <div className="rounded border border-border bg-bg p-6 text-body text-fg">{gate.message}</div>
    );
  } else if (sent) {
    body = (
      <div
        role="status"
        className="flex flex-col items-start gap-4 rounded border border-border bg-bg p-6"
      >
        <RichText value={confirmationOf(def)} className="text-body text-fg" />
        {def.allowMultiple && (
          <Button variant="secondary" loading={starting} onClick={() => void startAgain()}>
            Submit another response
          </Button>
        )}
        {startProblem && <p className="text-small text-danger">{startProblem}</p>}
      </div>
    );
  } else {
    body = (
      <form
        aria-labelledby={titleId}
        noValidate
        onSubmit={onSubmit}
        className="flex flex-col gap-4"
      >
        {summary && failed.length > 0 && (
          <div role="alert" className="flex flex-col gap-2 rounded border border-danger bg-bg p-4">
            <p className="text-body font-medium text-danger">{summary}</p>
            <ul className="flex flex-col gap-1">
              {failed.map((q) => (
                <li key={q.prop.id}>
                  <a
                    href={`#${questionDomId(q.prop.id)}`}
                    onClick={(event) => {
                      event.preventDefault();
                      focusQuestion(q.prop.id);
                    }}
                    className="text-small text-danger underline underline-offset-2"
                  >
                    {q.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        {asked
          .filter((q) => shown.has(q.prop.id))
          .map((q) => (
            <Question
              key={q.prop.id}
              asked={q}
              value={answers[q.prop.id]}
              error={errors[q.prop.id]}
              onUpdate={onUpdate}
              onLeave={onLeave}
              onKeyDown={onKeyDown}
              onUploads={onUploads}
              formId={formId}
              databaseId={databaseId}
              fill={fill}
              note={refile.has(q.prop.id) ? REFILE_NOTE : undefined}
            />
          ))}
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
        {banner && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded border border-border bg-bg p-4 text-small text-fg"
          >
            <span>{banner.text}</span>
            {banner.retry && (
              <Button variant="secondary" size="sm" onClick={() => void submit()}>
                Retry
              </Button>
            )}
          </div>
        )}
        <div>
          <Button type="submit" loading={sending}>
            {def.submitLabel.trim() || 'Submit'}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-4">
      {cover && cover !== brokenCover && (
        <img
          src={cover}
          alt=""
          className="h-40 w-full rounded object-cover"
          onError={() => setBrokenCover(cover)}
        />
      )}
      <header className="flex flex-col gap-2 rounded border border-border bg-bg p-6">
        {def.icon && (
          <span aria-hidden className="text-title">
            {def.icon}
          </span>
        )}
        <h1 id={titleId} className="text-title font-semibold text-fg">
          {title}
        </h1>
        <RichText value={def.description} className="text-body text-muted" />
        {anonymous && gate.state === 'open' && !sent && (
          <p className="text-small text-muted">{anonymous}</p>
        )}
      </header>
      {body}
      <footer className="flex items-center justify-center gap-2 py-2 text-small text-muted">
        <Logo size={16} decorative />
        <span>Care Hub</span>
      </footer>
    </div>
  );
}
