/**
 * A stand-in layout and panel for the shell's tests. The layout lists the rows it gets and keeps
 * its props, so a test can call the actions a real layout would; a view named "Broken view"
 * throws, as a broken layout would. The panel says which panel and view it got, keeps its props
 * and has a Done button that closes it. Tests swap them in with `vi.mock('../layouts', ...)` and
 * `vi.mock('../panels', ...)`.
 */
import { VIEW_LAYOUTS, type ViewLayout } from '@carehub/databases';
import { Button } from '@carehub/ui';
import {
  PANEL_LABELS,
  PANEL_NAMES,
  type LayoutProps,
  type PanelName,
  type PanelProps,
} from '../contract';
import type { LayoutComponent } from '../layouts';
import type { PanelComponent } from '../panels';

/** The props the probe drew with last. */
export const probe: { props: LayoutProps | null } = { props: null };

export const BROKEN_VIEW = 'Broken view';

export function ProbeLayout(props: LayoutProps) {
  if (props.view.name === BROKEN_VIEW) throw new Error('This layout is broken.');
  probe.props = props;
  const rows = props.data.groups ? props.data.groups.flatMap((g) => g.rows) : props.data.rows;
  return (
    <ul data-testid="probe-layout" aria-label={props.view.name}>
      {rows.map((row) => (
        <li key={row.id}>{row.title}</li>
      ))}
    </ul>
  );
}

export function probeLayouts(): Record<ViewLayout, LayoutComponent> {
  return Object.fromEntries(VIEW_LAYOUTS.map((layout) => [layout, ProbeLayout])) as Record<
    ViewLayout,
    LayoutComponent
  >;
}

/** The props the probe panel drew with last. */
export const panelProbe: { props: PanelProps | null } = { props: null };

export function ProbePanel(props: PanelProps) {
  panelProbe.props = props;
  return (
    <div data-testid="probe-panel">
      <p>{`${PANEL_LABELS[props.panel]} for ${props.view.name}`}</p>
      <Button size="sm" onClick={props.close}>
        Done
      </Button>
    </div>
  );
}

export function probePanels(): Record<PanelName, PanelComponent> {
  return Object.fromEntries(PANEL_NAMES.map((name) => [name, ProbePanel])) as Record<
    PanelName,
    PanelComponent
  >;
}
