import { todayIn } from '@carehub/team-time';
import { buttonClasses, VisuallyHidden } from '@carehub/ui';
import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { HomeSection, rowClasses, withData } from './HomeSection';
import type { SectionProps } from './sections';
import { isStillOn, upcomingDay, upcomingTime } from './time';
import { isJoinable, useUpcoming, type UpcomingItem } from './upcoming';

const SHOWN = 6;
// A few more than shown, so the list stays full as items end before the next refetch.
const FETCHED = 10;

/** The rest of today and tomorrow: time, title and Join when joinable (HR-02). */
export function UpcomingSection({ now, prefs }: SectionProps) {
  const query = useUpcoming(FETCHED);
  useRefetchOnNewDay(query.refetch, todayIn(prefs.timeZone, now));
  const items = query.data?.filter((item) => isStillOn(item, now, prefs.timeZone));
  return (
    <HomeSection
      title="Upcoming"
      link={{ label: 'Open Calendar', to: '/calendar' }}
      query={withData(query, items)}
      limit={SHOWN}
      empty="Nothing else today or tomorrow."
      noun="upcoming events"
      itemKey={(item) => item.id}
      groupOf={(item) => upcomingDay(item, now, prefs.timeZone)}
      renderItem={(item) => <UpcomingRow item={item} now={now} prefs={prefs} />}
    />
  );
}

function UpcomingRow({ item, now, prefs }: { item: UpcomingItem } & SectionProps) {
  const title = item.title || '(No title)';
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 max-md:flex-col max-md:items-stretch">
      <Link to={item.href} className={rowClasses}>
        <span className="w-20 shrink-0 text-muted">{upcomingTime(item, now, prefs)}</span>{' '}
        <span className="truncate">{title}</span>
      </Link>
      {item.videoLink && isJoinable(item, now) && (
        <a
          href={item.videoLink.url}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({ size: 'sm', className: 'max-md:w-full' })}
        >
          Join
          <VisuallyHidden>{` ${title}`}</VisuallyHidden>
        </a>
      )}
    </div>
  );
}

/** Tomorrow becomes today at midnight, so the list asks again for the new tomorrow. */
function useRefetchOnNewDay(refetch: () => unknown, today: string) {
  const seen = useRef(today);
  useEffect(() => {
    if (seen.current === today) return;
    seen.current = today;
    void refetch();
  }, [refetch, today]);
}
