// Why a page can't be edited, above its header (Pages and blocks, section 2, States): it's in
// Trash, archived or locked.
import {
  Button,
  cn,
  colorClasses,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from '@carehub/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { atLeast } from './access';
import {
  changePage,
  deleteForever,
  pagesKeys,
  parentInTrash,
  restoreFromTrash,
  type PageChange,
  type PageDetail,
} from './api';
import { stampLabel } from './page';
import { reasonOf } from './PageHeader';
import { titleOf } from './PageTree';

/**
 * Changes page `page` on the server, showing `shown` on its screen at once; if the server
 * refuses, the screen goes back and the toast titled `failed` says why.
 */
export function useChangePage(page: PageDetail) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  return async (change: PageChange, shown: Partial<PageDetail>, failed: string) => {
    const key = pagesKeys.page(page.id);
    await queryClient.cancelQueries({ queryKey: key });
    const before = queryClient.getQueryData<PageDetail>(key);
    queryClient.setQueryData<PageDetail>(key, (data) => data && { ...data, ...shown });
    try {
      await changePage(page.id, change);
    } catch (error) {
      queryClient.setQueryData(key, before);
      toast({ title: failed, description: reasonOf(error), variant: 'danger' });
    } finally {
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

export function PageBanner({ page }: { page: PageDetail }) {
  const change = useChangePage(page);
  if (page.deleted) return <TrashBanner page={page} />;
  if (page.archived) {
    return (
      <Banner className={cn(colorClasses.yellow.bg, colorClasses.yellow.text)}>
        {stampLabel('Archived', page.archived)}
        {atLeast(page.access, 'full') && (
          <BannerButton
            onClick={() =>
              void change({ archived: false }, { archived: null }, "Couldn't unarchive the page.")
            }
          >
            Unarchive
          </BannerButton>
        )}
      </Banner>
    );
  }
  if (page.locked) {
    return (
      <Banner className="bg-fill text-fg">
        <span aria-hidden>🔒</span> {stampLabel('Locked', page.locked)}
        {atLeast(page.access, 'edit') && (
          <BannerButton
            onClick={() =>
              void change({ locked: false }, { locked: null }, "Couldn't unlock the page.")
            }
          >
            Unlock
          </BannerButton>
        )}
      </Banner>
    );
  }
  return null;
}

function Banner({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn('flex flex-wrap items-center justify-center gap-x-1 px-4 py-2', className)}
    >
      {children}
    </div>
  );
}

function BannerButton({ onClick, children }: { onClick(): void; children: ReactNode }) {
  return (
    <>
      <span aria-hidden>·</span>
      <button type="button" onClick={onClick} className="rounded font-medium underline">
        {children}
      </button>
    </>
  );
}

/** "This page is in Trash." with Restore and Delete forever, for people with Full access. */
function TrashBanner({ page }: { page: PageDetail }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const full = atLeast(page.access, 'full');
  const failed = (title: string, error: unknown) =>
    toast({ title, description: reasonOf(error), variant: 'danger' });

  async function restore() {
    try {
      await restoreFromTrash(page.id);
      await queryClient.invalidateQueries({ queryKey: pagesKeys.all });
    } catch (error) {
      const parent = parentInTrash(error);
      if (parent) failed(`Restore ${titleOf(parent)} first. It's in Trash too.`, null);
      else failed(`Couldn't restore ${titleOf(page)}. Try again.`, error);
    }
  }

  async function remove() {
    setConfirming(false);
    try {
      await deleteForever(page.id);
      queryClient.removeQueries({ queryKey: pagesKeys.page(page.id) });
      void queryClient.invalidateQueries({ queryKey: pagesKeys.trash });
      void navigate('/', { replace: true });
    } catch (error) {
      failed(`Couldn't delete ${titleOf(page)}. Try again.`, error);
    }
  }

  return (
    <Banner className={cn('gap-x-3', colorClasses.red.bg, colorClasses.red.text)}>
      This page is in Trash.
      {full && (
        <>
          <Button size="sm" variant="secondary" onClick={() => void restore()}>
            Restore
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
            Delete forever
          </Button>
        </>
      )}
      {confirming && (
        <Dialog open onOpenChange={(open) => !open && setConfirming(false)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete {titleOf(page)} forever?</DialogTitle>
              <DialogDescription>This can&apos;t be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void remove()}>
                Delete forever
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Banner>
  );
}
