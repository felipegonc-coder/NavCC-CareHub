/**
 * The toolbar's panels: which one is open (one at a time, for the view showing) and how each is
 * drawn: by its builder's component (PANELS), inside the shell's frame.
 */
import { Suspense, useCallback, useMemo, useRef, useState } from 'react';
import type { Id } from '@carehub/databases';
import { Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton } from '@carehub/ui';
import { PANEL_LABELS, type PanelName, type PanelProps, type PanelTarget } from '../contract';
import { PANELS } from '../panels';
import { ErrorBoundary } from './boundary';

export interface Panels {
  /** The panel showing, if any. */
  open: PanelName | null;
  /** Where it was opened at (PanelProps.target); undefined when its button opened it. */
  target: PanelTarget | undefined;
  /**
   * Shows a panel, at `target` if given; when it closes, focus goes back to `opener` (else to what
   * had focus).
   */
  show(panel: PanelName, opener?: HTMLElement | null, target?: PanelTarget): void;
  /** A panel's button: shows the panel, or closes it when it's showing. */
  toggle(panel: PanelName, opener: HTMLElement): void;
  /** Closes the panel and gives focus back to what opened it (Esc, Close, the panel's own close). */
  close(): void;
  /** Closes the panel after a press somewhere else, leaving focus where it went. */
  dismiss(): void;
  /**
   * The panel's `onCloseAutoFocus`: once it has gone, focus goes back to what opened it after
   * close(), and stays put after dismiss().
   */
  closeAutoFocus(event: Event): void;
}

interface Shown {
  viewId: Id;
  panel: PanelName;
  target?: PanelTarget;
}

export function usePanels(viewId: Id): Panels {
  const [shown, setShown] = useState<Shown | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const giveBack = useRef(false);
  // Another view starts with its panels closed.
  const current = shown?.viewId === viewId ? shown : null;
  const open = current?.panel ?? null;
  const target = current?.target;

  const show = useCallback(
    (panel: PanelName, from?: HTMLElement | null, at?: PanelTarget) => {
      const focused = document.activeElement;
      opener.current = from ?? (focused instanceof HTMLElement ? focused : null);
      giveBack.current = false;
      setShown({ viewId, panel, target: at });
    },
    [viewId],
  );

  const dismiss = useCallback(() => {
    giveBack.current = false;
    setShown(null);
  }, []);

  const close = useCallback(() => {
    giveBack.current = true;
    setShown(null);
  }, []);

  const closeAutoFocus = useCallback((event: Event) => {
    // Not what had focus when it opened (often a menu item that has gone).
    event.preventDefault();
    if (!giveBack.current) return;
    giveBack.current = false;
    if (opener.current?.isConnected) opener.current.focus();
  }, []);

  const toggle = useCallback(
    (panel: PanelName, from: HTMLElement) => (open === panel ? close() : show(panel, from)),
    [open, close, show],
  );

  return useMemo(
    () => ({ open, target, show, toggle, close, dismiss, closeAutoFocus }),
    [open, target, show, toggle, close, dismiss, closeAutoFocus],
  );
}

/** A panel as its builder drew it; a panel that breaks shows the error state in its place. */
export function PanelBody(props: PanelProps) {
  const Panel = PANELS[props.panel];
  return (
    <ErrorBoundary>
      <Suspense fallback={<Skeleton className="h-24 w-64 max-w-full" />}>
        <Panel {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

export interface PanelDialogProps extends PanelProps {
  /** Panels.closeAutoFocus. */
  onCloseAutoFocus(event: Event): void;
}

/** Import CSV, Export CSV, Row access and Property access: a dialog with the title and Close. */
export function PanelDialog({ onCloseAutoFocus, ...props }: PanelDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.close();
      }}
    >
      <DialogContent aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{PANEL_LABELS[props.panel]}</DialogTitle>
        </DialogHeader>
        <PanelBody {...props} />
      </DialogContent>
    </Dialog>
  );
}
