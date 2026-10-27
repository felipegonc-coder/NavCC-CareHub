import type { CommentThreadView } from '@carehub/shared';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  IconButton,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@carehub/ui';
import { ArrowDownUp, X } from 'lucide-react';
import { useId, useState } from 'react';
import { CommentsContext } from './context';
import { useCommentActions, useComments, useViewer } from './hooks';
import { ThreadCard } from './thread-card';
import {
  visibleThreads,
  type LocateThread,
  type ThreadFilter,
  type ThreadOrder,
  type ThreadTab,
} from './threads';

export interface CommentsPanelProps {
  pageId: string;
  /** From the editor: where each thread's spot is, for "By position on the page". */
  locate?: LocateThread;
  /** A thread was clicked: scroll to its spot and highlight it for 2 seconds. */
  onOpenThread?(thread: CommentThreadView): void;
  /** Shows a close button. */
  onClose?(): void;
  className?: string;
}

const TABS: readonly ThreadTab[] = ['open', 'resolved'];
const FILTERS: readonly [ThreadFilter, string][] = [
  ['all', 'All'],
  ['forMe', 'For me'],
];

/** Comments in the top bar: the page's threads, with tabs, filters and order. */
export function CommentsPanel({
  pageId,
  locate,
  onOpenThread,
  onClose,
  className,
}: CommentsPanelProps) {
  const query = useComments(pageId);
  const viewer = useViewer();
  const actions = useCommentActions(pageId);
  const [tab, setTab] = useState<ThreadTab>('open');
  const [filter, setFilter] = useState<ThreadFilter>('all');
  const [order, setOrder] = useState<ThreadOrder>('position');
  const headingId = useId();

  const threads =
    query.data &&
    visibleThreads(query.data.threads, { tab, filter, order, viewerId: viewer?.id, locate });

  let body;
  if (query.isPending) {
    body = <Spinner label="Loading comments" />;
  } else if (!threads) {
    body = (
      <div className="flex flex-col items-center gap-2">
        <p className="text-small text-muted">Couldn&apos;t load comments.</p>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
          Try again
        </Button>
      </div>
    );
  } else if (threads.length === 0) {
    body = (
      <p className="text-small text-muted">
        {tab === 'open' ? 'No comments yet.' : 'No resolved comments.'}
      </p>
    );
  } else {
    body = (
      <ul data-thread-list="" className="flex w-full flex-col gap-3">
        {threads.map((thread) => (
          <li key={thread.id}>
            <ThreadCard
              thread={thread}
              gone={thread.spot === 'text' && locate?.(thread) === null}
              onOpen={onOpenThread}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className={cn('flex h-full w-full flex-col bg-bg md:w-96', className)}
    >
      <div className="flex items-center gap-1 px-4 pt-2">
        <h2 id={headingId} className="flex-1 text-body font-semibold">
          Comments
        </h2>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label="Order" size="sm">
              <ArrowDownUp aria-hidden />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Order</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={order}
              onValueChange={(value) => setOrder(value as ThreadOrder)}
            >
              <DropdownMenuRadioItem value="position">
                By position on the page
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="newest">Newest first</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {onClose && (
          <IconButton label="Close comments" size="sm" onClick={onClose}>
            <X aria-hidden />
          </IconButton>
        )}
      </div>
      <CommentsContext.Provider
        value={{
          pageId,
          people: query.data?.people ?? {},
          canComment: query.data?.canComment ?? false,
          viewer,
          actions,
        }}
      >
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ThreadTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex flex-col gap-2 px-4 pt-2">
            <TabsList aria-label="Threads">
              <TabsTrigger value="open">Open</TabsTrigger>
              <TabsTrigger value="resolved">Resolved</TabsTrigger>
            </TabsList>
            <div role="group" aria-label="Show" className="flex gap-1">
              {FILTERS.map(([value, label]) => (
                <Button
                  key={value}
                  variant={filter === value ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          {TABS.map((value) => (
            <TabsContent
              key={value}
              value={value}
              className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-4 pt-2"
            >
              {body}
            </TabsContent>
          ))}
        </Tabs>
      </CommentsContext.Provider>
    </section>
  );
}
