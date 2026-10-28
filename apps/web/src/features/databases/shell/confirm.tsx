/**
 * Asking before going on: a dialog with its own words and Continue or Cancel, as a button's "Show a
 * confirmation" step needs (Templates and buttons 3.4). Esc, a press outside or Close cancel too.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@carehub/ui';

export interface ConfirmWords {
  title: string;
  message: string;
  /** The Continue button's label ("Continue" when empty). */
  confirmLabel: string;
}

/** Resolves true for Continue, false for Cancel. A new question cancels the one showing. */
export type Confirm = (words: ConfirmWords) => Promise<boolean>;

interface Asking {
  words: ConfirmWords;
  answer(go: boolean): void;
}

const ConfirmContext = createContext<Confirm | null>(null);

export function ConfirmProvider({ children }: { children?: ReactNode }) {
  const [asking, setAsking] = useState<Asking | null>(null);
  const confirm = useCallback<Confirm>(
    (words) => new Promise<boolean>((resolve) => setAsking({ words, answer: resolve })),
    [],
  );
  // A question that goes unanswered (a new one came, or the screen went) is a Cancel.
  useEffect(() => {
    if (!asking) return;
    return () => asking.answer(false);
  }, [asking]);
  const answer = (go: boolean) => {
    asking?.answer(go);
    setAsking(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) answer(false);
        }}
      >
        {asking && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{asking.words.title}</DialogTitle>
              <DialogDescription>{asking.words.message}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => answer(false)}>
                Cancel
              </Button>
              <Button onClick={() => answer(true)}>
                {asking.words.confirmLabel || 'Continue'}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm needs a ConfirmProvider around it.');
  return confirm;
}
