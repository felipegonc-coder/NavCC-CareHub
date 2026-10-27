// Rendered once by the app shell (the `overlays` slot): problems the "/" menu and button blocks
// can't show themselves, as a toast.
import { useToast } from '@carehub/ui';
import { useEffect } from 'react';
import { useProblem } from './store';

export function ButtonProblems() {
  const problem = useProblem();
  const { toast } = useToast();
  useEffect(() => {
    if (problem) toast({ title: problem.message, variant: 'danger' });
  }, [problem, toast]);
  return null;
}
