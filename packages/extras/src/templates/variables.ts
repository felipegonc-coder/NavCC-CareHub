import { resolveDynamicDate } from '@carehub/databases/templates';
import { escapeMarkdown, type VariableValues } from './content';

// What variable chips become when a template is used or a button inserts blocks (spec 3.3):
// "Oct 26, 2026", "Oct 26, 2026, 9:05 AM", the person's name and a link to the new page. They
// become mention chips once mentions have an editor node; until then, plain text and a page link.

export interface VariableContext {
  /** The person using the template or pressing the button. */
  person: { name: string; timeZone: string; use24h: boolean };
  /** The page the chip lands on. */
  page: { id: string; title: string };
  now: Date;
}

/** "Oct 26, 2026" for a calendar date (YYYY-MM-DD). */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const utc = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(utc);
}

/** "Oct 26, 2026, 9:05 AM" in the person's time zone (24-hour if they chose it). */
export function formatMoment(iso: string, timeZone: string, use24h: boolean): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: use24h ? 'h23' : 'h12',
  })
    .format(new Date(iso))
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** The Markdown each chip becomes for this person and page. */
export function variableValues({ person, page, now }: VariableContext): VariableValues {
  return (kind, offsetDays) => {
    switch (kind) {
      case 'today':
      case 'now': {
        const value = resolveDynamicDate(
          { dynamic: kind, ...(offsetDays ? { offsetDays } : {}) },
          { timeZone: person.timeZone, now },
        );
        return escapeMarkdown(
          kind === 'today'
            ? formatDay(value.start)
            : formatMoment(value.start, person.timeZone, person.use24h),
        );
      }
      case 'me':
        return escapeMarkdown(person.name);
      case 'this_page':
        return `[${escapeMarkdown(page.title || 'Untitled')}](</p/${page.id}>)`;
    }
  };
}
