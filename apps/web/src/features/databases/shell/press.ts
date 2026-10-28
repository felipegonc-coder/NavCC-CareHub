/** What the toast says after a button press (Templates and buttons 3.4). */
import { BUTTON_MESSAGES } from '@carehub/databases/buttons';
import { UNKNOWN_ERROR_MESSAGE, type ButtonRunAnswer } from '../api';

export interface PressToast {
  /** The run's words without their closing "· Undo": the toast's own button says that. */
  message: string;
  /** Offer Undo: the run changed something. */
  undo: boolean;
}

const UNDO_WORDS = ` · ${BUTTON_MESSAGES.undo}`;

/** "Done · Undo" → "Done" with Undo; a failure in the server's words; null: nothing to say. */
export function pressToast(run: ButtonRunAnswer): PressToast | null {
  const undo = run.undoUntil !== null;
  const words = run.message?.endsWith(UNDO_WORDS)
    ? run.message.slice(0, -UNDO_WORDS.length)
    : run.message;
  if (words) return { message: words, undo };
  if (run.status === 'failed') return { message: UNKNOWN_ERROR_MESSAGE, undo };
  return undo ? { message: BUTTON_MESSAGES.done, undo } : null;
}
