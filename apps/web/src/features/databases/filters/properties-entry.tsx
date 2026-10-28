/** The Properties panel as the toolbar opens it (PANELS in ../panels.tsx), in the shell's popover. */
import type { PanelProps } from '../contract';
import { PropertiesPanel } from './properties-panel';

export default function PropertiesEntry({
  meta,
  view,
  viewer,
  actions,
  canEditViews,
  propertyIds,
}: PanelProps) {
  return (
    <div className="w-80 max-w-full">
      <PropertiesPanel
        meta={meta}
        view={view}
        viewer={viewer}
        actions={actions}
        canEditViews={canEditViews}
        propertyIds={propertyIds}
      />
    </div>
  );
}
