// The Version history window, drawn once by the app shell (overlays slot). The page menu,
// Ctrl+Alt+H and `?version=` links open it; Esc closes it.
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  LoadingState,
} from '@carehub/ui';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { closeVersionHistory, useVersionHistoryTarget } from './store';

const VersionHistory = lazy(async () => ({
  default: (await import('./VersionHistory')).VersionHistory,
}));

export function VersionHistoryOverlay() {
  const target = useVersionHistoryTarget();

  // Going to another screen (the browser's Back button, say) closes the window.
  const { pathname } = useLocation();
  const openedOn = useRef<string | null>(null);
  useEffect(() => {
    if (target === null) openedOn.current = null;
    else if (openedOn.current === null) openedOn.current = pathname;
    else if (openedOn.current !== pathname) closeVersionHistory();
  }, [target, pathname]);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) closeVersionHistory();
      }}
    >
      {target && (
        <DialogContent
          className="flex h-full max-w-none flex-col gap-0 p-0"
          // The window holds focus until the list loads and takes it.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
          }}
        >
          <DialogHeader className="border-b border-border px-4 py-3">
            <DialogTitle>Version history</DialogTitle>
            <DialogDescription>{target.page.title || 'Untitled'}</DialogDescription>
          </DialogHeader>
          <Suspense fallback={<LoadingState label="Loading versions" className="p-6" />}>
            <VersionHistory
              key={`${target.page.id}:${target.versionId ?? 'newest'}`}
              pageId={target.page.id}
              initialVersionId={target.versionId}
              onClose={closeVersionHistory}
            />
          </Suspense>
        </DialogContent>
      )}
    </Dialog>
  );
}
