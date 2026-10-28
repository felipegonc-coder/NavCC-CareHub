import type { CommentPerson, CreateCommentInput, MeResponse } from '@carehub/shared';
import { useToast } from '@carehub/ui';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useSyncExternalStore } from 'react';
import { api } from '../../lib/api';
import { useLiveTopic } from '../live';
import { commentsApi, commentsKey, commentsTopic, errorMessage } from './api';
import { Outbox } from './outbox';

/** A page's threads, fetched again whenever anyone changes them, so they show within 2 s. */
export function useComments(pageId: string) {
  const client = useQueryClient();
  useLiveTopic(commentsTopic(pageId), (event) => {
    if (event.type === 'comments.changed' || event.type === 'live-reconnected') {
      void client.invalidateQueries({ queryKey: commentsKey(pageId) });
    }
  });
  return useQuery({
    queryKey: commentsKey(pageId),
    queryFn: ({ signal }) => commentsApi.list(pageId, signal),
  });
}

/** The signed-in person: "For me", and the name on comments being sent. */
export function useViewer(): CommentPerson | undefined {
  const { data } = useQuery({
    queryKey: ['comments', 'viewer'],
    queryFn: ({ signal }) => api.get<MeResponse>('/api/auth/me', { signal }),
    staleTime: Infinity,
  });
  return data && { id: data.user.id, name: data.user.name, avatarUrl: data.user.avatarUrl };
}

const outboxes = new WeakMap<QueryClient, Map<string, Outbox>>();

/** One outbox per page. It outlives the panel, so a comment that failed is there when it opens. */
function outboxFor(client: QueryClient, pageId: string): Outbox {
  let pages = outboxes.get(client);
  if (!pages) outboxes.set(client, (pages = new Map()));
  let outbox = pages.get(pageId);
  if (!outbox) {
    outbox = new Outbox(async (input) => {
      const sent = await commentsApi.create(input);
      await client.invalidateQueries({ queryKey: commentsKey(pageId) });
      return sent;
    });
    pages.set(pageId, outbox);
  }
  return outbox;
}

/** Sending, editing, deleting and resolving. A change that fails says so in a toast. */
export function useCommentActions(pageId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const outbox = outboxFor(client, pageId);
  const outgoing = useSyncExternalStore(outbox.subscribe, outbox.getSnapshot);

  return useMemo(() => {
    const run = async (failed: string, change: () => Promise<unknown>): Promise<boolean> => {
      try {
        await change();
        await client.invalidateQueries({ queryKey: commentsKey(pageId) });
        return true;
      } catch (error) {
        toast({ title: failed, description: errorMessage(error), variant: 'danger' });
        return false;
      }
    };
    return {
      /** Comments still being sent, or that failed. */
      outgoing,
      /** A reply (with `threadId`) or a new thread. Resolves to its IDs, or null if it failed. */
      send: (input: Omit<CreateCommentInput, 'pageId'>) => outbox.send({ ...input, pageId }),
      retry: (outgoingId: string) => outbox.retry(outgoingId),
      discard: (outgoingId: string) => outbox.discard(outgoingId),
      edit: (commentId: string, text: string) =>
        run("Couldn't save your edit.", () => commentsApi.edit(commentId, text)),
      remove: (commentId: string) =>
        run("Couldn't delete the comment.", () => commentsApi.remove(commentId)),
      resolve: (threadId: string, resolved: boolean) =>
        run(resolved ? "Couldn't resolve the thread." : "Couldn't reopen the thread.", () =>
          commentsApi.resolve(threadId, resolved),
        ),
    };
  }, [client, toast, outbox, outgoing, pageId]);
}

export type CommentActions = ReturnType<typeof useCommentActions>;
