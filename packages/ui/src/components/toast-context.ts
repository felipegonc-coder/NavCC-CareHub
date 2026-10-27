import { createContext, useContext } from 'react';

export type ToastVariant = 'default' | 'success' | 'danger';

export interface ToastOptions {
  title: string;
  description?: string | undefined;
  /** 'danger' toasts are announced straight away; the others wait politely. */
  variant?: ToastVariant | undefined;
  /** How long it stays, in milliseconds. Hovering or focusing it pauses the timer. */
  duration?: number | undefined;
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
