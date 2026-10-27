// Events as outside calendars (Google, iCloud, private links) describe them. Shared by the
// iCalendar reader and writer and by the Google client.
//
// Wall-clock values have minute precision. `utc` instants are written the way
// `Date.prototype.toISOString()` writes them ('2026-10-27T16:00:00.000Z'); event times have
// zero seconds, `updatedAt` keeps its seconds.

export type ExternalTime =
  | { kind: 'date'; date: string } // all-day, 'YYYY-MM-DD'
  | { kind: 'zoned'; dateTime: string; timeZone: string } // 'YYYY-MM-DDTHH:mm', IANA zone
  | { kind: 'utc'; instant: string } // ISO 8601 ending in Z
  | { kind: 'floating'; dateTime: string }; // no zone given

export interface ExternalAttendee {
  email: string;
  name?: string;
  response: 'accepted' | 'declined' | 'tentative' | 'needs-action';
  organizer?: boolean;
}

export interface ExternalEvent {
  uid: string;
  remoteId?: string; // Google event id or CalDAV resource href
  etag?: string;
  recurrenceId?: ExternalTime; // set on a changed or cancelled occurrence of a series
  status: 'confirmed' | 'tentative' | 'cancelled';
  title: string;
  description?: string;
  location?: string;
  videoLink?: string;
  start: ExternalTime;
  end?: ExternalTime; // exclusive
  rrule?: string; // RRULE value without the "RRULE:" prefix
  exdates?: ExternalTime[];
  sequence?: number;
  updatedAt?: string; // ISO instant
  busy: boolean;
  visibility?: 'default' | 'public' | 'private';
  organizerEmail?: string;
  attendees?: ExternalAttendee[];
}
