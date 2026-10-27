/**
 * Short messages at the bottom of the screen, with Undo when a change can be taken back. A
 * stand-in until the design kit's toasts are on main; then this file re-exports those.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { LIMITS } from '@carehub/databases';
import { Button } from '@carehub/ui';

export interface ToastInput {
  message: string;
  /** Adds Undo; the toast then stays for 8 seconds (LIMITS.undoToastMs). */
  onUndo?: () => void;
}

export interface Toasts {
  /** Shows a toast in place of the one showing. */
  show(toast: ToastInput): void;
}

/** How long a toast without Undo stays. */
export const TOAST_MS = 5_000;

const ToastContext = createContext<Toasts | null>(null);

interface Shown extends ToastInput {
  id: number;
}

let lastId = 0;

export function ToastProvider({ children }: { children?: ReactNode }) {
  const [toast, setToast] = useState<Shown | null>(null);
  const show = useCallback((input: ToastInput) => {
    lastId += 1;
    setToast({ ...input, id: lastId });
  }, []);
  const toasts = useMemo<Toasts>(() => ({ show }), [show]);

  useEffect(() => {
    if (!toast) return;
    const ms = toast.onUndo ? LIMITS.undoToastMs : TOAST_MS;
    const timer = setTimeout(() => setToast((t) => (t?.id === toast.id ? null : t)), ms);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <ToastContext.Provider value={toasts}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4"
      >
        {toast && (
          <div className="pointer-events-auto flex items-center gap-3 rounded border border-border bg-bg py-1 pl-4 pr-1 text-small text-fg shadow-menu">
            <span className="py-1">{toast.message}</span>
            {toast.onUndo && (
              <Button
                variant="ghost"
                size="sm"
                className="max-md:min-h-11"
                onClick={() => {
                  toast.onUndo?.();
                  setToast(null);
                }}
              >
                Undo
              </Button>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

/** Gives its children toasts, unless a screen around them already does. */
export function WithToasts({ children }: { children?: ReactNode }) {
  const outer = useContext(ToastContext);
  return outer ? children : <ToastProvider>{children}</ToastProvider>;
}

export function useToasts(): Toasts {
  const toasts = useContext(ToastContext);
  if (!toasts) throw new Error('useToasts needs a ToastProvider (or WithToasts) around it.');
  return toasts;
}
