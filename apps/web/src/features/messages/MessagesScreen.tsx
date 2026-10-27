import { SquarePen } from 'lucide-react';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { COPY } from '@carehub/team-chat';
import { cn, IconButton } from '@carehub/ui';
import { usePageTitle } from '../../lib/usePageTitle';
import { NoticesChat } from '../notices';
import { CARE_HUB_ID } from './chat-info';
import { ChatHeader } from './ChatHeader';
import { ChatList } from './ChatList';
import { ChatView, MessagesLoading } from './ChatView';
import { useChatList, useMessagesLive } from './data';
import { NewMessageDialog } from './NewMessageDialog';

/** Messages: the chat list beside the open chat; on phones each is its own screen. */
export function MessagesScreen() {
  usePageTitle('Messages');
  useMessagesLive();
  const chatId = useParams()['*'] || null;
  const [search, setSearch] = useSearchParams();
  // Guests have only the 🔔 chat, so they can't start one.
  const guest = useChatList().data === null;
  const newOpen = search.get('new') === '1' && !guest;
  const setNewOpen = (open: boolean) =>
    setSearch(
      (current) => {
        const next = new URLSearchParams(current);
        if (open) next.set('new', '1');
        else next.delete('new');
        return next;
      },
      { replace: true },
    );

  return (
    <main className="relative flex-1" data-testid="messages-screen">
      <div className="absolute inset-0 flex">
        <section
          aria-labelledby="messages-heading"
          className={cn(
            'min-h-0 w-full flex-col border-r border-border md:flex md:w-80 md:shrink-0',
            chatId ? 'hidden' : 'flex',
          )}
        >
          <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
            <h1 id="messages-heading" className="text-h2">
              Messages
            </h1>
            {!guest && (
              <IconButton
                label="New message"
                data-testid="messages-new"
                onClick={() => setNewOpen(true)}
              >
                <SquarePen className="size-4" aria-hidden />
              </IconButton>
            )}
          </div>
          <ChatList activeId={chatId} />
        </section>
        <section
          aria-label="Chat"
          className={cn('min-h-0 min-w-0 flex-1 flex-col md:flex', chatId ? 'flex' : 'hidden')}
        >
          {chatId === CARE_HUB_ID ? (
            <>
              <ChatHeader
                title={
                  <>
                    <span aria-hidden>🔔 </span>
                    {COPY.careHubChatName}
                  </>
                }
              />
              <Suspense fallback={<MessagesLoading />}>
                <NoticesChat className="min-h-0 flex-1" />
              </Suspense>
            </>
          ) : chatId ? (
            <ChatView key={chatId} chatId={chatId} />
          ) : (
            <p className="m-auto p-6 text-muted" data-testid="messages-no-chat-open">
              Pick a chat, or start one with New message.
            </p>
          )}
        </section>
      </div>
      <NewMessageDialog open={newOpen} onOpenChange={setNewOpen} />
    </main>
  );
}
