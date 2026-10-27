import { createContext, useContext } from 'react';

export type ToastVariant = 'default' | 'success' | 'danger';

/** One button in a toast, such as Undo. Pressing it runs `onClick`, then closes the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  title: string;
  description?: string | undefined;
  /** 'danger' toasts are announced straight away; the others wait politely. */
  variant?: ToastVariant | undefined;
  /**
   * How long it stays, in milliseconds: 5 seconds, or 8 with an action (the specs' Undo toast).
   * Hovering or focusing it pauses the timer.
   */
  duration?: number | undefined;
  /**
   * Screen readers hear its label with the message; F8 takes keyboard focus to it. Since the timer
   * stops while the toast has the pointer or focus, an Undo can come after the server's window:
   * the server answers 409 `conflict`, and the screen shows a short "Too late to undo" toast.
   */
  action?: ToastAction | undefined;
}

export interface ToastApi {
  toast: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastApi | null>(null);

/** `const { toast } = useToast(); toast({ title: 'Saved' })` */
export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>.');
  return value;
}
