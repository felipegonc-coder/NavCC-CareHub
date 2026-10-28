import { useEffect, useRef } from 'react';
import { useToast } from '@carehub/ui';

/**
 * Shows one toast when it mounts, then says so (`onShown`). The table mounts it only when there's
 * something to say, so it needs the kit's ToastProvider (the app has one) only then.
 */
export function Notice({ text, onShown }: { text: string; onShown: () => void }) {
  const { toast } = useToast();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    toast({ title: text });
    onShown();
  }, [toast, text, onShown]);
  return null;
}
