// The page's header (Pages and blocks, sections 2 and 3.1): its cover, its icon and its title.
import { Button, cn, useToast } from '@carehub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Smile } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { changePage, type PageDetail } from './api';
import { reasonOf, showEverywhere, useChangePage } from './change';
import { IconPicker } from './IconPicker';
import { cleanTitle, TITLE_MAX } from './page';
import { PageCover, randomCover } from './PageCover';
import type { PageIcon } from './types';

/** How long typing in the title pauses before the new title is sent. */
const SAVE_AFTER_MS = 500;

/** The text column: about 768 px, or the whole width with Full width. */
export const columnClasses = (fullWidth: boolean) =>
  cn('mx-auto w-full px-6 max-md:px-4', fullWidth ? 'max-w-none md:px-24' : 'max-w-page');

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
  const change = useChangePage(page.id);
  const setIcon = (icon: PageIcon | null) =>
    void change(
      { icon },
      { icon },
      icon ? "Couldn't change the icon." : "Couldn't remove the icon.",
    );
  const addCover = () => {
    const cover = randomCover();
    void change(
      { cover, coverPosition: 50 },
      { cover, coverPosition: 50 },
      "Couldn't add a cover.",
    );
  };
  const emoji = page.icon?.type === 'emoji' ? page.icon.emoji : null;

  return (
    <div className="group/header flex flex-col">
      <PageCover page={page} editable={editable} />
      <div className={cn(columnClasses(page.fullWidth), 'flex flex-col gap-2 pt-12 max-md:pt-6')}>
        {emoji &&
          (editable ? (
            <IconPicker icon={page.icon} onChange={setIcon}>
              <button
                type="button"
                aria-label="Page icon"
                className="self-start rounded text-6xl leading-none hover:bg-fill-hover"
              >
                {emoji}
              </button>
            </IconPicker>
          ) : (
            <span role="img" aria-label="Page icon" className="text-6xl leading-none">
              {emoji}
            </span>
          ))}
        {editable && (!emoji || !page.cover) && (
          // Shown on hover or focus on computers, always on phones (section 2, Header).
          <div className="flex gap-1 md:opacity-0 md:focus-within:opacity-100 md:group-hover/header:opacity-100">
            {!emoji && (
              <IconPicker icon={null} onChange={setIcon}>
                <Button variant="ghost" size="sm">
                  <Smile aria-hidden />
                  Add icon
                </Button>
              </IconPicker>
            )}
            {!page.cover && (
              <Button variant="ghost" size="sm" onClick={addCover}>
                <ImageIcon aria-hidden />
                Add cover
              </Button>
            )}
          </div>
        )}
        <PageTitle page={page} editable={editable} autoFocus={autoFocus} onEnter={onEnter} />
      </div>
    </div>
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
