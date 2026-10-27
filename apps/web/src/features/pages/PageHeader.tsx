// The page's header (Pages and blocks, sections 2 and 3.1): its cover, its icon and its title.
import { cn, coverGradients, isCoverName, useToast } from '@carehub/ui';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../../lib/api';
import { changePage, pagesKeys, type PageDetail } from './api';
import { cleanTitle, patchCached, TITLE_MAX, type ShownFields } from './page';

/** How long typing in the title pauses before the new title is sent. */
const SAVE_AFTER_MS = 500;

/** The text column: about 768 px, or the whole width with Full width. */
export const columnClasses = (fullWidth: boolean) =>
  cn('mx-auto w-full px-6 max-md:px-4', fullWidth ? 'max-w-none md:px-24' : 'max-w-page');

const isPageData = (key: readonly unknown[]) => !['prefs', 'me'].includes(String(key[1]));

/** Shows `fields` of page `id` in every page list and screen at once, before the server answers. */
export function showEverywhere(queryClient: QueryClient, id: string, fields: ShownFields) {
  for (const [key, data] of queryClient.getQueriesData({ queryKey: pagesKeys.all })) {
    if (data !== undefined && isPageData(key)) {
      queryClient.setQueryData(key, patchCached(data, id, fields));
    }
  }
}

export const reasonOf = (error: unknown) =>
  error instanceof ApiError && error.status < 500 ? error.message : undefined;

export interface PageHeaderProps {
  page: PageDetail;
  /** Whether the person may change the title, icon and cover now. */
  editable: boolean;
  /** Puts the cursor in the title as the page opens, as for a page just made. */
  autoFocus: boolean;
  /** Enter in the title: on to the first block. */
  onEnter(): void;
}

export function PageHeader({ page, editable, autoFocus, onEnter }: PageHeaderProps) {
  return (
    <div className="flex flex-col">
      {page.cover && <PageCover page={page} />}
      <div className={cn(columnClasses(page.fullWidth), 'flex flex-col gap-2 pt-12 max-md:pt-6')}>
        {page.icon && <PageIcon page={page} />}
        <PageTitle page={page} editable={editable} autoFocus={autoFocus} onEnter={onEnter} />
      </div>
    </div>
  );
}

/** 160 px tall on phones and 280 px on computers (section 3.1). */
const COVER_CLASSES = 'h-40 w-full md:h-[17.5rem]';

function PageCover({ page }: { page: PageDetail }) {
  const { cover, coverPosition } = page;
  if (cover?.type === 'file') {
    return (
      <img
        src={`/api/files/${cover.fileId}`}
        alt="Page cover"
        className={cn(COVER_CLASSES, 'object-cover')}
        style={{ objectPosition: `center ${coverPosition}%` }}
      />
    );
  }
  const gradient = cover && isCoverName(cover.name) ? coverGradients[cover.name] : undefined;
  return (
    <div
      role="img"
      aria-label="Page cover"
      className={cn(COVER_CLASSES, 'bg-fill')}
      style={{ backgroundImage: gradient }}
    />
  );
}

function PageIcon({ page }: { page: PageDetail }) {
  if (page.icon?.type !== 'emoji') return null;
  return (
    <span role="img" aria-label="Page icon" className="text-6xl leading-none">
      {page.icon.emoji}
    </span>
  );
}

/**
 * The title: plain text that saves as it's typed and shows at once in the sidebar, breadcrumbs and
 * browser tab. If the server refuses it, the last saved title comes back and a toast says why.
 */
function PageTitle({ page, editable, autoFocus, onEnter }: PageHeaderProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const field = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(page.title);
  const saved = useRef(page.title);
  const waiting = useRef<{ timer: ReturnType<typeof setTimeout>; title: string } | null>(null);
  const sending = useRef(0);

  const send = useCallback(() => {
    const next = waiting.current;
    if (!next) return;
    clearTimeout(next.timer);
    waiting.current = null;
    sending.current += 1;
    changePage(page.id, { title: next.title }).then(
      () => {
        sending.current -= 1;
        saved.current = next.title;
        // A reload that crossed this save may have brought back the title before it.
        if (!waiting.current) showEverywhere(queryClient, page.id, { title: next.title });
      },
      (error: unknown) => {
        sending.current -= 1;
        if (waiting.current) return;
        setValue(saved.current);
        showEverywhere(queryClient, page.id, { title: saved.current });
        toast({
          title: "Couldn't rename the page.",
          description: reasonOf(error),
          variant: 'danger',
        });
      },
    );
  }, [page.id, queryClient, toast]);

  // A rename from elsewhere shows here, unless the person's own typing is still on its way.
  useEffect(() => {
    if (!waiting.current && sending.current === 0) {
      setValue(page.title);
      saved.current = page.title;
    }
  }, [page.title]);

  useEffect(() => send, [send]);

  useEffect(() => {
    if (autoFocus) field.current?.focus();
  }, [autoFocus]);

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value]);

  function type(text: string) {
    const title = cleanTitle(text);
    setValue(title);
    showEverywhere(queryClient, page.id, { title });
    if (waiting.current) clearTimeout(waiting.current.timer);
    waiting.current = { timer: setTimeout(send, SAVE_AFTER_MS), title };
  }

  return (
    <h1 className="text-title">
      <textarea
        ref={field}
        aria-label="Page title"
        placeholder="Untitled"
        rows={1}
        maxLength={TITLE_MAX}
        readOnly={!editable}
        value={value}
        onChange={(event) => type(event.target.value)}
        onBlur={send}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
          onEnter();
        }}
        className="block w-full resize-none overflow-hidden bg-transparent text-title text-fg placeholder:text-faint focus:outline-none"
      />
    </h1>
  );
}
