import { formatGreeting } from '@carehub/team-time';
import type { ReactNode } from 'react';
import { usePageTitle } from '../../lib/usePageTitle';
import { CustomizeHome } from './CustomizeHome';
import { SectionBoundary } from './HomeSection';
import { homeSections, type HomeSectionEntry } from './sections';
import { DEFAULT_HOME_SETTINGS, useHomeSettings } from './settings';
import { useNow } from './time';
import { useViewer, type Viewer } from './viewer';

/**
 * Home at `/`: the greeting, then what needs attention now, without the sections the person hid.
 * The sections wait for the person's settings, so a hidden one never flashes up; if the settings
 * can't be loaded, every section shows.
 */
export function HomeScreen({
  sections = homeSections,
}: {
  sections?: readonly HomeSectionEntry[];
}) {
  usePageTitle();
  const now = useNow();
  const viewer = useViewer();
  const settings = useHomeSettings();
  const hidden = settings.data?.hiddenSections ?? DEFAULT_HOME_SETTINGS.hiddenSections;
  const shown = settings.isPending ? [] : sections.filter(({ id }) => !hidden.includes(id));
  return (
    <HomeView
      sections={shown}
      now={now}
      viewer={viewer}
      actions={<CustomizeHome sections={sections} />}
      empty={
        !settings.isPending && (
          <p className="text-body text-muted">
            Every section is hidden. Use Customize Home to show them again.
          </p>
        )
      }
    />
  );
}

export interface HomeViewProps {
  sections: readonly HomeSectionEntry[];
  now: Date;
  viewer: Viewer;
  /** Beside the greeting, such as Customize Home. */
  actions?: ReactNode;
  /** In place of the sections when there are none to show. */
  empty?: ReactNode;
}

/** One column on a phone and a tablet, two from 1024 px wide, in the same order. */
export function HomeView({ sections, now, viewer, actions, empty }: HomeViewProps) {
  return (
    <main className="flex w-full flex-col gap-8 px-6 py-10 max-md:gap-6 max-md:px-4 max-md:py-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-title text-fg max-md:text-h2">
          {formatGreeting(viewer.name, now, viewer.prefs)}
        </h1>
        {actions}
      </div>
      {sections.length > 0 ? (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {sections.map(({ id, title, Component }) => (
            <SectionBoundary key={id} title={title}>
              <Component now={now} prefs={viewer.prefs} />
            </SectionBoundary>
          ))}
        </div>
      ) : (
        empty
      )}
    </main>
  );
}
