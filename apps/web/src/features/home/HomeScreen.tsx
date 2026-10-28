import { formatGreeting } from '@carehub/team-time';
import { usePageTitle } from '../../lib/usePageTitle';
import { SectionBoundary } from './HomeSection';
import { homeSections, type HomeSectionEntry } from './sections';
import { useNow } from './time';
import { useViewer, type Viewer } from './viewer';

/** Home at `/`: the greeting, then what needs attention now. */
export function HomeScreen() {
  usePageTitle();
  const now = useNow();
  const viewer = useViewer();
  return <HomeView sections={homeSections} now={now} viewer={viewer} />;
}

export interface HomeViewProps {
  sections: readonly HomeSectionEntry[];
  now: Date;
  viewer: Viewer;
}

/** One column on a phone and a tablet, two from 1024 px wide, in the same order. */
export function HomeView({ sections, now, viewer }: HomeViewProps) {
  return (
    <main className="flex w-full flex-col gap-8 px-6 py-10 max-md:gap-6 max-md:px-4 max-md:py-6">
      <h1 className="text-title text-fg max-md:text-h2">
        {formatGreeting(viewer.name, now, viewer.prefs)}
      </h1>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {sections.map(({ id, title, Component }) => (
          <SectionBoundary key={id} title={title}>
            <Component now={now} prefs={viewer.prefs} />
          </SectionBoundary>
        ))}
      </div>
    </main>
  );
}
