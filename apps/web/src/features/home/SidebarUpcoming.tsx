import type { TimePrefs } from '@carehub/team-time';
import { buttonClasses, cn, IconButton, SidebarGroup, sidebarRowClasses } from '@carehub/ui';
import { ChevronDown, ChevronRight, Video } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import { DEFAULT_HOME_SETTINGS, useChangeHomeSettings, useHomeSettings } from './settings';
import { isStillOn, upcomingDay, upcomingTime, useNow } from './time';
import { isJoinable, useUpcoming, type UpcomingItem } from './upcoming';
import { useViewer } from './viewer';

const SHOWN = 3;
// The same request as Home's Upcoming, so the two share it.
const FETCHED = 10;

/**
 * The sidebar's Upcoming, under the top items: the next 3 events of today and tomorrow from the
 * same sources as Home's Upcoming, each opening in Calendar, with Join when joinable. The heading
 * folds, and stays folded for the person (their Home settings).
 */
export function SidebarUpcoming() {
  const settings = useHomeSettings();
  const change = useChangeHomeSettings();
  const folded = (settings.data ?? DEFAULT_HOME_SETTINGS).upcomingFolded;
  const listId = useId();
  return (
    <SidebarGroup
      title="Upcoming"
      actions={
        <IconButton
          label={folded ? 'Show upcoming events' : 'Hide upcoming events'}
          size="sm"
          className="size-6 max-md:size-11"
          aria-expanded={!folded}
          aria-controls={listId}
          disabled={!settings.isSuccess}
          onClick={() => change.mutate({ upcomingFolded: !folded })}
        >
          {folded ? <ChevronRight aria-hidden /> : <ChevronDown aria-hidden />}
        </IconButton>
      }
    >
      <div id={listId} hidden={folded}>
        {!folded && <UpcomingList />}
      </div>
    </SidebarGroup>
  );
}

function UpcomingList() {
  const now = useNow();
  const { prefs } = useViewer();
  const query = useUpcoming(FETCHED);
  if (query.isPending) return null;
  if (query.isError) {
    return (
      <div role="alert" className="flex items-center gap-2 px-2 text-small text-muted">
        Couldn&apos;t load upcoming events.
        <button
          type="button"
          className={buttonClasses({ variant: 'ghost', size: 'sm' })}
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }
  const items = (query.data ?? [])
    .filter((item) => isStillOn(item, now, prefs.timeZone))
    .slice(0, SHOWN);
  if (items.length === 0) return <p className="px-2 text-small text-muted">Nothing else today</p>;
  const days = ['Today', 'Tomorrow'] as const;
  return (
    <div className="flex flex-col gap-1">
      {days.map((day) => {
        const ofDay = items.filter((item) => upcomingDay(item, now, prefs.timeZone) === day);
        if (ofDay.length === 0) return null;
        return (
          <div key={day} className="flex flex-col gap-1">
            <h3 className="px-2 text-label text-muted">{day}</h3>
            <ul className="flex flex-col gap-1">
              {ofDay.map((item) => (
                <UpcomingRow key={item.id} item={item} now={now} prefs={prefs} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function UpcomingRow({
  item,
  now,
  prefs,
}: {
  item: UpcomingItem;
  now: Date;
  prefs: Readonly<TimePrefs>;
}) {
  const title = item.title || '(No title)';
  return (
    <li className="flex items-center gap-1">
      <Link to={item.href} className={cn(sidebarRowClasses(), 'min-w-0 flex-1')}>
        <span className="shrink-0">{upcomingTime(item, now, prefs)}</span>{' '}
        <span className="truncate text-fg">{title}</span>
      </Link>
      {item.videoLink && isJoinable(item, now) && (
        <a
          href={item.videoLink.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Join ${title}`}
          className={buttonClasses({ variant: 'ghost', size: 'sm', icon: true })}
        >
          <Video aria-hidden />
        </a>
      )}
    </li>
  );
}
