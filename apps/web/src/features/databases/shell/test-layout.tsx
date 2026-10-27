/**
 * A stand-in layout for the shell's tests: it lists the rows it gets and keeps its props, so a
 * test can call the actions a real layout would. Tests swap it in with
 * `vi.mock('../layouts', ...)`. A view named "Broken view" throws, as a broken layout would.
 */
import { VIEW_LAYOUTS, type ViewLayout } from '@carehub/databases';
import type { LayoutProps } from '../contract';
import type { LayoutComponent } from '../layouts';

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
