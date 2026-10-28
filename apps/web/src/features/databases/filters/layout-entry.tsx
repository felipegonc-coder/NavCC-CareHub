/**
 * The Layout panel as the toolbar's "…" → Layout opens it (PANELS in ../panels.tsx), with the
 * workspace's people for color rules' Person conditions.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { personChoice } from '../api';
import type { PanelProps } from '../contract';
import { membersQuery, useDatabaseClient } from '../hooks';
import { LayoutPanel } from './layout-panel';

export default function LayoutEntry({
  meta,
  view,
  viewer,
  actions,
  canEditViews,
  propertyIds,
  rowTitles,
}: PanelProps) {
  const client = useDatabaseClient();
  const members = useQuery(membersQuery(client, ''));
  const people = useMemo(() => (members.data ?? []).map(personChoice), [members.data]);
  return (
    <div className="min-w-80 max-w-full">
      <LayoutPanel
        meta={meta}
        view={view}
        viewer={viewer}
        actions={actions}
        canEditViews={canEditViews}
        propertyIds={propertyIds}
        people={people}
        rowTitles={rowTitles}
      />
    </div>
  );
}
