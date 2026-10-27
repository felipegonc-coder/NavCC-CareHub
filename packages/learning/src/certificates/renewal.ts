import type { IsoDate } from '../format/index';
import { compareDays, daysBetween } from '../util/index';
import { certificateStatus } from './expiry';
import type { CertificateRecord } from './issue';

/** The expiry notices a certificate holder can get. */
export type CertificateNoticeKind = 'expiring_soon' | 'expired';

/** An expiry notice that was sent for a certificate, and the calendar day it went out. */
export type SentCertificateNotice = { kind: CertificateNoticeKind; on: IsoDate };

/**
 * The wording and button of an expiry notice; the job adds workspaceId, userId, kind and sender.
 */
export type CertificateNotice = {
  title: string;
  text: string;
  buttons: { label: string; href: string }[];
};

/**
 * The expiry notice to send `today` for a learner's current certificate (`currentCertificates`),
 * given the ones already sent for it, or null: "expiring_soon" once, from `headsUpDays` days before
 * the expiry day; "expired" once, from the expiry day on. When the heads-up was missed, only
 * "expired" goes out. A certificate that never expires gets none. Asking again on the same day
 * sends nothing new.
 */
export function certificateNoticeDue(
  cert: Pick<CertificateRecord, 'expiresOn'>,
  sent: readonly SentCertificateNotice[],
  today: IsoDate,
  headsUpDays = 30,
): CertificateNoticeKind | null {
  const status = certificateStatus(cert, today, headsUpDays);
  if (status === 'valid') return null;
  return sent.some((notice) => notice.kind === status) ? null : status;
}

function inDays(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

function daysAgo(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/**
 * The notice for one expiry on `today`. The course title appears only when `canOpen` is true (the
 * person can open the course now); otherwise the text says "one of your certificates", so a notice
 * never names a course the person might not have access to. The button opens the course to take
 * it again, or the certificate when the course can't be opened.
 */
export function certificateNotice(
  kind: CertificateNoticeKind,
  cert: Pick<CertificateRecord, 'id' | 'courseId' | 'courseTitle' | 'expiresOn'>,
  options: { today: IsoDate; canOpen: boolean },
): CertificateNotice {
  const { today, canOpen } = options;
  const days = cert.expiresOn === null ? null : daysBetween(today, cert.expiresOn);
  const subject = canOpen
    ? `Your certificate for “${cert.courseTitle}”`
    : 'One of your certificates';
  const renew = canOpen ? ' Take the course again to renew it.' : '';
  const button = canOpen
    ? { label: 'Open course', href: `/learning/courses/${encodeURIComponent(cert.courseId)}` }
    : { label: 'Open certificate', href: `/learning/certificates/${encodeURIComponent(cert.id)}` };
  if (kind === 'expiring_soon') {
    const when = days === null || days < 0 ? 'soon' : inDays(days);
    const text = `${subject} expires ${when}.${renew}`;
    return { title: `Certificate expires ${when}`, text, buttons: [button] };
  }
  const when = days === null || days > 0 ? 'has expired' : `expired ${daysAgo(-days)}`;
  return { title: 'Certificate expired', text: `${subject} ${when}.${renew}`, buttons: [button] };
}

/**
 * Re-certification, for courses whose certificates expire: from the heads-up window on, the course
 * is assigned to the learner again, due on the expiry day (today, if that has passed). Returns that
 * due date, or null while the certificate is valid or if it never expires. The server records that
 * it reassigned, so this happens once per certificate.
 */
export function recertificationDueDate(
  cert: Pick<CertificateRecord, 'expiresOn'>,
  today: IsoDate,
  headsUpDays = 30,
): IsoDate | null {
  const { expiresOn } = cert;
  if (expiresOn === null || certificateStatus(cert, today, headsUpDays) === 'valid') return null;
  return compareDays(expiresOn, today) > 0 ? expiresOn : today;
}
