import { useLocation, useSearchParams } from 'react-router';
import { cn, Skeleton, VisuallyHidden } from '@carehub/ui';
import { ApiError } from '../../lib/api';
import { ChatHeader } from './ChatHeader';
import { useChat, useHistory } from './data';
import { useAfter } from './hooks';
import { LoadError } from './LoadError';
import { OpenChat } from './OpenChat';

/** Grey message bubbles while a chat loads. */
export function MessagesLoading() {
  const show = useAfter(300);
  return (
    <div
      aria-busy="true"
      className="flex flex-1 flex-col justify-end gap-4 p-4"
      data-testid="messages-chat-loading"
    >
      <VisuallyHidden>Loading messages…</VisuallyHidden>
      {show &&
        ['w-1/2', 'w-2/3', 'w-1/3'].map((width) => (
          <div key={width} className="flex gap-3">
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className={cn('h-10', width)} />
            </div>
          </div>
        ))}
    </div>
  );
}

const statusOf = (error: Error) => (error instanceof ApiError ? error.status : null);

/** The open chat: loading, the reason it can't open, or the chat itself. */
export function ChatView({ chatId }: { chatId: string }) {
  const chat = useChat(chatId);
  const history = useHistory(chatId);
  // ?message=<id>: a search result or a notification opens the chat at that message.
  const [params] = useSearchParams();
  const { key: locationKey } = useLocation();
  const error = chat.error ?? history.error;

  if (error) {
    const status = statusOf(error);
    if (status === 404 || status === 403) {
      return (
        <>
          <ChatHeader title={status === 404 ? 'Not found' : 'No access'} />
          <p className="p-4 text-muted" data-testid="messages-chat-unavailable">
            {status === 404 ? "This chat doesn't exist." : "You're not in this chat."}
          </p>
        </>
      );
    }
    return (
      <>
        <ChatHeader title="Messages" />
        <LoadError
          message={error.message}
          onRetry={() => {
            void chat.refetch();
            void history.refetch();
          }}
        />
      </>
    );
  }
  if (!chat.data || !history.data) {
    return (
      <>
        <ChatHeader title={<Skeleton className="h-4 w-40" />} />
        <MessagesLoading />
      </>
    );
  }
  return (
    <OpenChat
      chatId={chatId}
      answer={chat.data}
      pages={history.data.pages}
      hasOlder={history.hasNextPage}
      loadingOlder={history.isFetchingNextPage}
      onLoadOlder={() => void history.fetchNextPage({ cancelRefetch: false })}
      settled={!chat.isFetching && !history.isFetching}
      focusId={params.get('message')}
      focusKey={locationKey}
    />
  );
}
