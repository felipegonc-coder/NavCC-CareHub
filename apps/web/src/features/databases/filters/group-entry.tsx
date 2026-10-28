/** The Group panel as the toolbar opens it (PANELS in ../panels.tsx), in the shell's popover. */
import type { PanelProps } from '../contract';
import { GroupPanel } from './group-panel';

export default function GroupEntry({
  meta,
  view,
  viewer,
  actions,
  canEditViews,
  data,
  propertyIds,
  rowTitles,
}: PanelProps) {
  return (
    <div className="w-80 max-w-full">
      <GroupPanel
        meta={meta}
        view={view}
        viewer={viewer}
        actions={actions}
        canEditViews={canEditViews}
        propertyIds={propertyIds}
        rowTitles={rowTitles}
        groups={data?.groups}
        lanes={data?.lanes}
      />
    </div>
  );
}
