// The Updates panel, drawn once by the app shell (overlays slot): tall beside the page, full
// screen on phones. The page menu opens it; Esc closes it, and so does going to another screen.
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@carehub/ui';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { openVersionHistory } from './store';
import { Updates } from './Updates';
import { closeUpdates, useUpdatesPage } from './updatesStore';

export function UpdatesOverlay() {
  const page = useUpdatesPage();

  const { pathname } = useLocation();
  const openedOn = useRef<string | null>(null);
  useEffect(() => {
    if (page === null) openedOn.current = null;
    else if (openedOn.current === null) openedOn.current = pathname;
    else if (openedOn.current !== pathname) closeUpdates();
  }, [page, pathname]);

  return (
    <Dialog
      open={page !== null}
      onOpenChange={(open) => {
        if (!open) closeUpdates();
      }}
    >
      {page && (
        <DialogContent className="flex h-full flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle>Updates</DialogTitle>
            <DialogDescription>{page.title || 'Untitled'}</DialogDescription>
          </DialogHeader>
          <Updates
            key={page.id}
            pageId={page.id}
            onShowChanges={(versionId) => {
              closeUpdates();
              openVersionHistory(page, versionId);
            }}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}
