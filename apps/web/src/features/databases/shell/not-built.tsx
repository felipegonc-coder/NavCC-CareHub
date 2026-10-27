import { LAYOUT_LABELS } from '@carehub/databases';
import type { LayoutProps } from '../contract';

/** Stands in for a layout until its builder's pull request lands. */
export default function NotBuilt({ view }: LayoutProps) {
  return (
    <p className="px-2 py-6 text-body text-muted">
      {LAYOUT_LABELS[view.layout]} views aren&apos;t ready yet.
    </p>
  );
}
