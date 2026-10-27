// What sidebar entries do: add, rename, star, copy link, move and move to Trash. Edits show at
// once; if the server refuses one, it's undone and a message says so.
import { useToast } from '@carehub/ui';
import { useQuery, useQueryClient, type Query, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { ApiError } from '../../lib/api';
import { pageUrl } from './access';
import {
  accessChangeOf,
  addFavorite,
  createPage,
  fetchFavorites,
  movePage,
  pagesKeys,
  removeFavorite,
  renamePage,
  trashPage,
  type AccessChange,
  type NewPagePlace,
} from './api';
import { usePermission } from './me';
import { movedTrees, type MoveTo } from './move';
import { useFlagPref } from './prefs';
import { subtreeIds } from './tree';
import type { PageLink, TreeNode } from './types';

export interface EntryActions {
  /** The person's role may create pages. */
  canCreate: boolean;
  isFavorite(id: string): boolean;
  toggleFavorite(page: TreeNode | PageLink): void;
  copyLink(id: string): void;
  rename(id: string, title: string): void;
  trash(page: TreeNode): void;
  /** Adds an untitled page and opens it with the cursor in the title. */
  create(place: NewPagePlace): void;
  move(page: TreeNode, to: MoveTo): void;
}

/** What the screen using the actions shows for moves (see `useMoveDialogs`). */
export interface MoveHost {
  /** Asks whether to go ahead with a move that changes who can open the page. */
  confirmMove(page: TreeNode, change: AccessChange): Promise<boolean>;
}

type Change = (data: unknown, key: readonly unknown[]) => unknown;

/** Page data in the cache; the person's settings and account aren't touched. */
const isPageData = (query: Query) => !['prefs', 'me'].includes(String(query.queryKey[1]));

const hasId = (item: unknown): item is { id: string } =>
  typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string';

const reason = (error: unknown) =>
  error instanceof ApiError && error.status < 500 ? error.message : undefined;

/** Applies `change` to every page query now, runs `request`, and puts things back if it fails. */
async function optimistic(
  queryClient: QueryClient,
  change: Change,
  request: () => Promise<unknown>,
): Promise<unknown> {
  const filters = { queryKey: pagesKeys.all, predicate: isPageData };
  await queryClient.cancelQueries(filters);
  const before = queryClient.getQueriesData(filters);
  for (const [key, data] of before) {
    if (data !== undefined) queryClient.setQueryData(key, change(data, key));
  }
  try {
    await request();
    return null;
  } catch (error) {
    for (const [key, data] of before) queryClient.setQueryData(key, data);
    return error ?? new Error('failed');
  } finally {
    void queryClient.invalidateQueries(filters);
  }
}

export function useEntryActions(host: MoveHost): EntryActions {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const canCreate = usePermission('pages.create');
  const [, setStarred] = useFlagPref('sidebar.starred', false);
  const favorites = useQuery({ queryKey: pagesKeys.favorites, queryFn: fetchFavorites }).data;

  return useMemo(() => {
    const starred = new Set(favorites?.map((page) => page.id));
    const failed = (title: string, error: unknown) =>
      toast({ title, description: reason(error), variant: 'danger' });

    return {
      canCreate,
      isFavorite: (id) => starred.has(id),

      toggleFavorite(page) {
        const on = !starred.has(page.id);
        const link: PageLink = { ...page, spaceId: 'spaceId' in page ? page.spaceId : undefined };
        const change: Change = (data, key) => {
          if (key[1] !== 'favorites' || !Array.isArray(data)) return data;
          const rest = data.filter((item) => !hasId(item) || item.id !== page.id);
          return on ? [...rest, link] : rest;
        };
        if (on) setStarred(true);
        void optimistic(queryClient, change, () =>
          on ? addFavorite(page.id) : removeFavorite(page.id),
        ).then((error) => {
          if (error) {
            failed(
              on ? "Couldn't add it to Favorites." : "Couldn't remove it from Favorites.",
              error,
            );
          }
        });
      },

      copyLink(id) {
        const url = new URL(pageUrl(id), window.location.origin).href;
        Promise.resolve()
          .then(() => navigator.clipboard.writeText(url))
          .then(
            () => toast({ title: 'Link copied', variant: 'success' }),
            () => toast({ title: "Couldn't copy the link.", variant: 'danger' }),
          );
      },

      rename(id, title) {
        const change: Change = (data) => {
          if (Array.isArray(data)) {
            return data.map((item) => (hasId(item) && item.id === id ? { ...item, title } : item));
          }
          return hasId(data) && data.id === id ? { ...data, title } : data;
        };
        void optimistic(queryClient, change, () => renamePage(id, title)).then((error) => {
          if (error) failed("Couldn't rename the page.", error);
        });
      },

      trash(page) {
        // The page goes with everything under it, from every list it's in.
        const gone = new Set([page.id]);
        for (const [, data] of queryClient.getQueriesData<TreeNode[]>({
          queryKey: pagesKeys.all,
        })) {
          if (Array.isArray(data) && data.some((item) => hasId(item) && 'parentId' in item)) {
            for (const id of subtreeIds(data, page.id)) gone.add(id);
          }
        }
        const change: Change = (data) =>
          Array.isArray(data) ? data.filter((item) => !hasId(item) || !gone.has(item.id)) : data;
        void optimistic(queryClient, change, () => trashPage(page.id)).then((error) => {
          if (error) failed("Couldn't move the page to Trash.", error);
          else toast({ title: 'Moved to Trash' });
        });
      },

      create(place) {
        createPage(place).then(
          (page) => {
            void queryClient.invalidateQueries({ queryKey: pagesKeys.all, predicate: isPageData });
            void navigate(pageUrl(page.id), { state: { focusTitle: true } });
          },
          (error: unknown) => failed("Couldn't add the page.", error),
        );
      },

      move(page, to) {
        const trees = new Map<string, TreeNode[]>();
        for (const [key, data] of queryClient.getQueriesData<TreeNode[]>({
          queryKey: pagesKeys.trees,
        })) {
          if (typeof key[2] === 'string' && Array.isArray(data)) trees.set(key[2], data);
        }
        const moved = movedTrees(trees, page.id, to);
        const change: Change = (data, key) =>
          key[1] === 'tree' && typeof key[2] === 'string' ? (moved.get(key[2]) ?? data) : data;
        const run = (confirmed: boolean): Promise<void> =>
          optimistic(queryClient, change, () => movePage(page.id, to, confirmed)).then(
            async (error) => {
              if (!error) return;
              const access = confirmed ? null : accessChangeOf(error);
              if (!access) failed("Couldn't move the page.", error);
              else if (await host.confirmMove(page, access)) await run(true);
            },
          );
        void run(false);
      },
    } satisfies EntryActions;
  }, [canCreate, favorites, host, navigate, queryClient, setStarred, toast]);
}
