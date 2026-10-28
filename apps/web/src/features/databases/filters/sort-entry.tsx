/** The Sort panel as the toolbar opens it (PANELS in ../panels.tsx), inside the shell's popover. */
import type { PanelProps } from '../contract';
import { SortPanel } from './sort-panel';

export default function SortEntry({ meta, view, viewer, actions, propertyIds }: PanelProps) {
  return (
    <div className="w-96 max-w-full">
      <SortPanel
        meta={meta}
        view={view}
        viewer={viewer}
        actions={actions}
        propertyIds={propertyIds}
      />
    </div>
  );
}
