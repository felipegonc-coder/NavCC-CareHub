/** The Group panel as the toolbar opens it (PANELS in ../panels.tsx), in the shell's popover. */
import type { PanelProps, ViewData } from '../contract';
import { GroupPanel } from './group-panel';

/** `data`: the view's query answer when the shell passes it: group names, what the viewer sees. */
export type GroupEntryProps = PanelProps & {
  data?: Pick<ViewData, 'groups' | 'lanes' | 'propertyIds' | 'rowTitles'> | undefined;
};

export default function GroupEntry({
  meta,
  view,
  viewer,
  actions,
  canEditViews,
  data,
}: GroupEntryProps) {
  return (
    <div className="w-80 max-w-full">
      <GroupPanel
        meta={meta}
        view={view}
        viewer={viewer}
        actions={actions}
        canEditViews={canEditViews}
        propertyIds={data?.propertyIds}
        rowTitles={data?.rowTitles}
        groups={data?.groups}
        lanes={data?.lanes}
      />
    </div>
  );
}
