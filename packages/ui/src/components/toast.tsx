import * as ToastPrimitive from '@radix-ui/react-toast';
import { X } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { IconButton } from './icon-button';
import { ToastContext, type ToastOptions, type ToastVariant } from './toast-context';

interface ToastItem extends ToastOptions {
  id: number;
}

const accents: Record<ToastVariant, string> = {
  default: 'border-l-border-hover',
  success: 'border-l-success',
  danger: 'border-l-danger',
};

/** Short messages in the bottom corner. F8 jumps to them with the keyboard. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((options: ToastOptions) => {
    nextId.current += 1;
    const id = nextId.current;
    setItems((current) => [...current, { ...options, id }]);
  }, []);

  const api = useMemo(() => ({ toast }), [toast]);
  const remove = (id: number) => setItems((current) => current.filter((item) => item.id !== id));

  return (
    <ToastContext value={api}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            type={item.variant === 'danger' ? 'foreground' : 'background'}
            duration={item.duration ?? 5000}
            onOpenChange={(open: boolean) => {
              if (!open) remove(item.id);
            }}
            className={cn(
              'relative grid gap-1 rounded border border-l-4 border-border bg-bg py-3 pl-4 pr-10 text-fg shadow-menu animate-pop-in data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]',
              accents[item.variant ?? 'default'],
            )}
          >
            <ToastPrimitive.Title className="text-small font-semibold">
              {item.title}
            </ToastPrimitive.Title>
            {item.description && (
              <ToastPrimitive.Description className="text-small text-muted">
                {item.description}
              </ToastPrimitive.Description>
            )}
            <ToastPrimitive.Close asChild>
              <IconButton label="Dismiss notification" size="sm" className="absolute right-1 top-1">
                <X aria-hidden />
              </IconButton>
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-full max-w-sm flex-col gap-2 p-4 focus:outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext>
  );
}
