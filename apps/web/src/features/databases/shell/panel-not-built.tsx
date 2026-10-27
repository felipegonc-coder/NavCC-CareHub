import { PANEL_LABELS, type PanelProps } from '../contract';

/** Stands in for a panel until its builder's pull request lands. */
export default function PanelNotBuilt({ panel }: PanelProps) {
  return (
    <p className="px-2 py-1 text-small text-muted">{PANEL_LABELS[panel]} isn&apos;t ready yet.</p>
  );
}
