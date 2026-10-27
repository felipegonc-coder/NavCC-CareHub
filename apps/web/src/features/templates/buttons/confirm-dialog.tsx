// Show a confirmation: the setter's text with Continue (or their label) and Cancel, which stops
// the run.
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@carehub/ui';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onContinue(): void;
  onCancel(): void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onContinue,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onCancel()}>
      <DialogContent {...(message ? {} : { 'aria-describedby': undefined })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {message && <DialogDescription>{message}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onContinue}>{confirmLabel || 'Continue'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
