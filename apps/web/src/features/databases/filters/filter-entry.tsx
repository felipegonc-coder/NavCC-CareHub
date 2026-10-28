/**
 * The Filter panel as the toolbar opens it (PANELS in ../panels.tsx), inside the shell's popover,
 * with the workspace's people for Person rules. A filter chip opens it on its rule; otherwise it
 * starts on the property list, or on the advanced filter when the view has one.
 */
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { personChoice } from '../api';
import type { PanelProps } from '../contract';
import { membersQuery, useDatabaseClient } from '../hooks';
import { FilterPanel } from './filter-panel';
import type { PanelExtras } from './types';

export default function FilterEntry(props: PanelProps & PanelExtras) {
  const { meta, view, viewer, actions, propertyIds, rowTitles, target, close } = props;
  const client = useDatabaseClient();
  const members = useQuery(membersQuery(client, ''));
  const people = useMemo(() => (members.data ?? []).map(personChoice), [members.data]);
  return (
    <div className="min-w-80 max-w-full">
      <FilterPanel
        key={`${target?.ruleId ?? ''}:${target?.advanced ? 'advanced' : ''}`}
        meta={meta}
        view={view}
        viewer={viewer}
        actions={actions}
        propertyIds={propertyIds}
        people={people}
        rowTitles={rowTitles}
        ruleId={target?.ruleId}
        advanced={target?.advanced}
        onClose={close}
      />
    </div>
  );
}
