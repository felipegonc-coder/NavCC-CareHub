/** The Properties panel as the toolbar opens it (PANELS in ../panels.tsx), in the shell's popover. */
import type { Id } from '@carehub/databases';
import type { PanelProps } from '../contract';
import { PropertiesPanel } from './properties-panel';

export interface PropertiesEntryProps extends PanelProps {
  /** The properties the viewer can see (the query answer's propertyIds), when the shell has them. */
  propertyIds?: readonly Id[] | undefined;
}

export default function PropertiesEntry({
  meta,
  view,
  viewer,
  actions,
  canEditViews,
  propertyIds,
}: PropertiesEntryProps) {
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
