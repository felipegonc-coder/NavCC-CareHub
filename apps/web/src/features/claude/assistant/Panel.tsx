// The assistant panel (Claude features spec, sections 2, 3.3 and 6): Floating (400 × 600 px at the
// bottom right), Side panel (on the right, 320 to 640 px wide) or Full screen, as the person last
// chose on this device, and always full screen on a phone. The header has the person's chats, New
// chat, the layout and Close. Esc stops an answer on its way, or closes the panel.
import {
  CHAT_QUESTIONS_MAX,
  ASSISTANT_TEXTS,
  type AskRequest,
  type AssistantPageLink,
  type AssistantScope,
} from '@carehub/extras/claude/assistant';
import { blocksText, markdownToBlocks } from '@carehub/extras/claude/markdown';
import {
  breakpoints,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  IconButton,
  LoadingState,
  useMediaQuery,
  VisuallyHidden,
} from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  History,
  Maximize2,
  PanelRight,
  PictureInPicture2,
  SquarePen,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useLocation } from 'react-router';
import { WRITING_TEXT } from '../write/ResultBox';
import { chatKey, loadChat } from './api';
import { ChatList } from './ChatList';
import { Conversation } from './Conversation';
import { pageIdOf } from './page';
import {
  FLOATING_SIZE,
  LAYOUT_LABELS,
  PANEL_LAYOUTS,
  setPanelLayout,
  setSideWidth,
  showChat,
  SIDE_STEP,
  SIDE_WIDTH,
  usePanel,
  type PanelLayout,
} from './panel';
import { QuestionBox } from './QuestionBox';
import { useAsk } from './useAsk';

/** Floating and Side panel need room; narrower windows show Full screen. */
export const DESKTOP = `(min-width: ${breakpoints.md})`;

const LAYOUT_ICONS: Readonly<Record<PanelLayout, LucideIcon>> = {
  floating: PictureInPicture2,
  side: PanelRight,
  full: Maximize2,
};

export interface PanelProps {
  /** Who is signed in. */
  person: string;
  onClose: () => void;
}

export function Panel({ person, onClose }: PanelProps) {
  const { layout, sideWidth, chatId } = usePanel();
  const desktop = useMediaQuery(DESKTOP);
  const shown: PanelLayout = desktop ? layout : 'full';
  const pageId = pageIdOf(useLocation().pathname);
  const ask = useAsk(person);
  const [view, setView] = useState<'chat' | 'chats'>('chat');
  const [text, setText] = useState('');
  const [pages, setPages] = useState<AssistantPageLink[]>([]);
  const [picked, setPicked] = useState<AssistantScope | null>(null);
  /** Changes whenever the question box should get focus. */
  const [focusTurn, setFocusTurn] = useState(0);
  const section = useRef<HTMLElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const newChatButton = useRef<HTMLButtonElement>(null);
  const dragging = useRef(false);

  // This page is the default on a page; elsewhere there's no page to read.
  const scope: AssistantScope =
    picked === null || picked === 'this_page' ? (pageId ? 'this_page' : 'all_pages') : picked;

  const chat = useQuery({
    queryKey: chatKey(person, chatId ?? ''),
    queryFn: ({ signal }) => loadChat(chatId ?? '', signal),
    enabled: chatId !== null,
  });
  const full = (chat.data?.chat.questions ?? 0) >= CHAT_QUESTIONS_MAX;
  const heard = useMemo(
    () => (ask.answered ? blocksText(markdownToBlocks(ask.answered)) : ''),
    [ask.answered],
  );

  useEffect(() => {
    if (view === 'chat') box.current?.focus();
  }, [view, focusTurn]);

  const focusBox = () => setFocusTurn((turn) => turn + 1);

  const stop = () => {
    const stopped = ask.stop();
    if (stopped && !text.trim()) {
      setText(stopped.request.question);
      setPages(stopped.pages);
    }
    focusBox();
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const target = event.target;
      if (!(target instanceof Node) || !section.current?.contains(target)) return;
      event.preventDefault();
      if (ask.waiting) stop();
      else onClose();
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  });

  const newChat = () => {
    ask.stop();
    showChat(null);
    setPages([]);
    setPicked(null);
    setView('chat');
    focusBox();
  };

  const openChat = (id: string) => {
    if (id !== chatId) ask.stop();
    showChat(id);
    setView('chat');
    focusBox();
  };

  const send = () => {
    const question = text.trim();
    if (!question || ask.waiting || full) return;
    const request: AskRequest = {
      ...(chatId ? { chatId } : {}),
      question,
      scope,
      ...(scope === 'this_page' && pageId ? { pageId } : {}),
      pageIds: pages.map(({ id }) => id),
    };
    ask.send(request, pages);
    setText('');
    setPages([]);
  };

  const title =
    view === 'chats' ? 'Chats' : chatId ? (chat.data?.chat.title ?? 'Chat') : 'New chat';

  const header = (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
      <IconButton
        label={view === 'chats' ? 'Back to the chat' : 'Chats'}
        onClick={() => setView(view === 'chats' ? 'chat' : 'chats')}
      >
        {view === 'chats' ? <ArrowLeft aria-hidden /> : <History aria-hidden />}
      </IconButton>
      <h2 className="min-w-0 flex-1 truncate px-1 text-h3">{title}</h2>
      <IconButton ref={newChatButton} label="New chat" onClick={newChat}>
        <SquarePen aria-hidden />
      </IconButton>
      {desktop && <LayoutMenu layout={layout} sideWidth={sideWidth} />}
      <IconButton label="Close" onClick={onClose}>
        <X aria-hidden />
      </IconButton>
    </header>
  );

  let conversation;
  if (chatId && chat.isPending) {
    conversation = <LoadingState label="Loading the chat" className="p-4" />;
  } else if (chatId && chat.isError) {
    conversation = (
      <ErrorState
        message="Couldn't load this chat."
        onRetry={() => void chat.refetch()}
        retrying={chat.isFetching}
      />
    );
  } else {
    conversation = (
      <Conversation
        messages={chat.data?.messages ?? []}
        asking={ask.asking}
        pageId={pageId}
        onRetry={ask.retry}
        onOpenSource={() => {
          // Full screen covers the page the link opens.
          if (shown === 'full') onClose();
        }}
      />
    );
  }

  const body = (
    <>
      {header}
      <div
        role="region"
        aria-label={view === 'chats' ? 'Chats' : 'Conversation'}
        tabIndex={view === 'chat' ? 0 : undefined}
        className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-offset-inset"
      >
        <div className={cn(shown === 'full' && 'mx-auto w-full max-w-page')}>
          {view === 'chats' ? (
            <ChatList
              person={person}
              current={chatId}
              onOpen={openChat}
              onDeleted={(id) => {
                if (id === chatId) newChat();
              }}
              onNoRows={() => newChatButton.current?.focus()}
            />
          ) : (
            conversation
          )}
        </div>
      </div>
      {view === 'chat' && (
        <div className={cn(shown === 'full' && 'mx-auto w-full max-w-page')}>
          {full ? (
            <div className="flex flex-col items-start gap-2 border-t p-3">
              <p className="text-small text-muted">{ASSISTANT_TEXTS.chatFull}</p>
              <Button size="sm" onClick={newChat}>
                New chat
              </Button>
            </div>
          ) : (
            <QuestionBox
              person={person}
              text={text}
              onTextChange={setText}
              scope={scope}
              onScopeChange={setPicked}
              onPage={pageId !== null}
              pages={pages}
              onPagesChange={setPages}
              waiting={ask.waiting}
              onSend={send}
              onStop={stop}
              boxRef={box}
            />
          )}
        </div>
      )}
      <VisuallyHidden role="status">{ask.waiting ? WRITING_TEXT : heard}</VisuallyHidden>
    </>
  );

  if (shown === 'floating') {
    return (
      <div className="pointer-events-none fixed inset-4 z-30 flex items-end justify-end">
        <section
          ref={section}
          aria-label="Claude"
          className="pointer-events-auto flex max-h-full max-w-full flex-col overflow-hidden rounded border bg-bg text-fg shadow-dialog"
          style={{ width: FLOATING_SIZE.width, height: FLOATING_SIZE.height }}
        >
          {body}
        </section>
      </div>
    );
  }

  if (shown === 'side') {
    const drag = (event: PointerEvent<HTMLDivElement>) => {
      if (dragging.current) setSideWidth(window.innerWidth - event.clientX);
    };
    const endDrag = () => {
      dragging.current = false;
    };
    return (
      <section
        ref={section}
        aria-label="Claude"
        className="fixed inset-y-0 right-0 z-30 flex max-w-full flex-col border-l bg-bg text-fg shadow-dialog"
        style={{ width: sideWidth }}
      >
        {/* Dragging the edge changes the width; Wider and Narrower in the layout menu do it by keyboard. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 cursor-col-resize touch-none hover:bg-border-hover"
          onPointerDown={(event) => {
            dragging.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={drag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        {body}
      </section>
    );
  }

  return (
    <section
      ref={section}
      aria-label="Claude"
      className="fixed inset-0 z-30 flex flex-col bg-bg text-fg"
    >
      {body}
    </section>
  );
}

interface LayoutMenuProps {
  layout: PanelLayout;
  sideWidth: number;
}

function LayoutMenu({ layout, sideWidth }: LayoutMenuProps) {
  const Icon = LAYOUT_ICONS[layout];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`Show as: ${LAYOUT_LABELS[layout]}`}>
          <Icon aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show as</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={layout}
          onValueChange={(value) => {
            const next = PANEL_LAYOUTS.find((one) => one === value);
            if (next) setPanelLayout(next);
          }}
        >
          {PANEL_LAYOUTS.map((one) => (
            <DropdownMenuRadioItem key={one} value={one}>
              {LAYOUT_LABELS[one]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {layout === 'side' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={sideWidth >= SIDE_WIDTH.max}
              onSelect={(event) => {
                event.preventDefault();
                setSideWidth(sideWidth + SIDE_STEP);
              }}
            >
              Wider
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={sideWidth <= SIDE_WIDTH.min}
              onSelect={(event) => {
                event.preventDefault();
                setSideWidth(sideWidth - SIDE_STEP);
              }}
            >
              Narrower
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
