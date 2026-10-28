/** The Layout panel as the toolbar's "…" → Layout opens it (PANELS in ../panels.tsx). */
import type { PanelProps } from '../contract';
import { LayoutPanel } from './layout-panel';

export default function LayoutEntry({
  meta,
  view,
  actions,
  canEditViews,
  propertyIds,
}: PanelProps) {
  return (
    <div className="w-80 max-w-full">
      <LayoutPanel
        meta={meta}
        view={view}
        actions={actions}
        canEditViews={canEditViews}
        propertyIds={propertyIds}
      />
    </div>
  );
}
