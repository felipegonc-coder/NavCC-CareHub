/**
 * The toolbar's panels: which one is open (one at a time, for the view showing), and the frame it
 * draws in, under the toolbar or as a dialog for Import CSV and Export CSV.
 */
import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import type { Id } from '@carehub/databases';
import { Skeleton } from '@carehub/ui';
import { DIALOG_PANELS, PANEL_LABELS, type PanelName, type PanelProps } from '../contract';
import { PANELS } from '../panels';
import { ErrorBoundary } from './boundary';
import { Dialog, Popover, useOutsidePress, type InsideProps } from './overlay';

export interface Panels {
  /** The panel showing, if any. */
  open: PanelName | null;
  /** Shows a panel; when it closes, focus goes back to `opener` (else to what had focus). */
  show(panel: PanelName, opener?: HTMLElement | null): void;
  /** A panel's button: shows the panel, or closes it when it's showing. */
  toggle(panel: PanelName, opener: HTMLElement): void;
  /** Closes the panel and gives focus back to its button. */
  close(): void;
  /** Goes on the toolbar's box: a press anywhere else closes a panel under the toolbar. */
  inside: InsideProps;
}

interface Shown {
  viewId: Id;
  panel: PanelName;
}

export function usePanels(viewId: Id): Panels {
  const [shown, setShown] = useState<Shown | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = shown?.viewId === viewId ? shown.panel : null;

  const show = useCallback(
    (panel: PanelName, from?: HTMLElement | null) => {
      const focused = document.activeElement;
      opener.current = from ?? (focused instanceof HTMLElement ? focused : null);
      setShown({ viewId, panel });
    },
    [viewId],
  );

  const close = useCallback(() => {
    setShown(null);
    if (opener.current?.isConnected) opener.current.focus();
  }, []);

  const toggle = useCallback(
    (panel: PanelName, from: HTMLElement) => (open === panel ? close() : show(panel, from)),
    [open, close, show],
  );

  // A press elsewhere leaves focus where it landed.
  const inside = useOutsidePress(open !== null && !DIALOG_PANELS.has(open), () => setShown(null));

  return useMemo(
    () => ({ open, show, toggle, close, inside }),
    [open, show, toggle, close, inside],
  );
}

export type PanelFrameProps = Omit<PanelProps, 'panel' | 'close'>;

/** The open panel, drawn by its builder's component (PANELS) inside the shell's frame. */
export function PanelFrame({ panels, ...props }: PanelFrameProps & { panels: Panels }) {
  const panel = panels.open;
  if (!panel) return null;
  const Panel = PANELS[panel];
  const label = PANEL_LABELS[panel];
  const body = (
    <ErrorBoundary>
      <Suspense fallback={<Skeleton className="h-24 w-64 max-w-full" />}>
        <Panel {...props} panel={panel} close={panels.close} />
      </Suspense>
    </ErrorBoundary>
  );
  return DIALOG_PANELS.has(panel) ? (
    <Dialog key={panel} title={label} onClose={panels.close}>
      {body}
    </Dialog>
  ) : (
    <Popover key={panel} label={label} onClose={panels.close}>
      {body}
    </Popover>
  );
}
