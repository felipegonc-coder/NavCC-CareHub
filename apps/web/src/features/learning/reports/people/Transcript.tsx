import type { CourseStatus, IsoDate, PersonTranscriptResponse } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { Link } from 'react-router';
import { apiPath } from '../../data';
import {
  certificatePageHref,
  csvHref,
  daysLate,
  formatCalendarDay,
  formatDay,
  formatMinutes,
  formatPercent,
  STATUS_LABELS,
} from './data';
import { CELL, CsvLink, HEAD_CELL, None, ReportPage, ReportTable } from './parts';

type TranscriptRow = PersonTranscriptResponse['rows'][number];
type Certificate = NonNullable<TranscriptRow['certificate']>;

const HEADINGS = [
  'Course',
  'Status',
  'Score',
  'Time spent',
  'Attempts',
  'Started',
  'Completed',
  'Due',
  'Certificate',
];

const FINISHED = new Set<CourseStatus>(['completed', 'passed']);
const STATUS_TONES: Partial<Record<CourseStatus, string>> = {
  completed: 'text-success',
  passed: 'text-success',
  failed: 'text-danger',
};

/** "1 course", "3 courses". */
export const courseCount = (count: number): string =>
  `${count} ${count === 1 ? 'course' : 'courses'}`;

/**
 * A person's learning record: every course they were given or started, newest first, with status,
 * score, time spent, attempts, dates and their current certificate, and the same as CSV.
 */
export function TranscriptView({
  transcript,
  today,
}: {
  transcript: PersonTranscriptResponse;
  today: IsoDate;
}) {
  const { person, rows } = transcript;
  const finished = rows.filter((row) => FINISHED.has(row.status)).length;
  const late = rows.filter((row) => daysLate(row, today) > 0).length;
  return (
    <ReportPage title={`${person.name} · Learning record`}>
      <div className="flex flex-col gap-2">
        <p className="text-small text-muted">Learning record</p>
        <h1 className="break-words text-title">{person.name}</h1>
        <p className="text-body text-muted">
          {[courseCount(rows.length), `${finished} finished`, late > 0 && `${late} overdue`]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <CsvLink href={csvHref(apiPath('reports', 'people', person.id))} />
      {rows.length === 0 ? (
        <p className="text-body text-muted">No courses yet: nothing assigned or started.</p>
      ) : (
        <ReportTable caption={`Courses of ${person.name}`}>
          <thead>
            <tr>
              {HEADINGS.map((heading) => (
                <th key={heading} scope="col" className={HEAD_CELL}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <TranscriptLine key={row.courseId} row={row} today={today} />
            ))}
          </tbody>
        </ReportTable>
      )}
    </ReportPage>
  );
}

/** One course of the record. */
function TranscriptLine({ row, today }: { row: TranscriptRow; today: IsoDate }) {
  const late = daysLate(row, today);
  const started = row.status !== 'not_started';
  return (
    <tr>
      <th scope="row" className={cn(CELL, 'font-medium')}>
        <span className="break-words">{row.courseTitle}</span>
        {row.required && <span className="block text-small font-normal text-muted">Required</span>}
      </th>
      <td className={CELL}>
        <span className={STATUS_TONES[row.status]}>{STATUS_LABELS[row.status]}</span>
        {late > 0 && (
          <span className="block text-danger">
            {late === 1 ? '1 day overdue' : `${late} days overdue`}
          </span>
        )}
      </td>
      <td className={CELL}>{formatPercent(row.score) ?? <None />}</td>
      <td className={CELL}>{started ? formatMinutes(row.activeSeconds) : <None />}</td>
      <td className={CELL}>{started ? row.attempts : <None />}</td>
      <td className={CELL}>{formatDay(row.startedAt) ?? <None />}</td>
      <td className={CELL}>{formatDay(row.completedAt) ?? <None />}</td>
      <td className={CELL}>{formatCalendarDay(row.dueDate) ?? <None />}</td>
      <td className={CELL}>
        {row.certificate ? <CertificateCell certificate={row.certificate} /> : <None />}
      </td>
    </tr>
  );
}

const CERTIFICATE_TONES: Record<Certificate['status'], string> = {
  valid: 'text-muted',
  expiring_soon: 'text-warning',
  expired: 'text-danger',
};

/** The course's current certificate: its code, linking to it, and whether it's still good. */
function CertificateCell({ certificate }: { certificate: Certificate }) {
  const expires = formatCalendarDay(certificate.expiresOn);
  return (
    <>
      <Link
        to={certificatePageHref(certificate.id)}
        className="whitespace-nowrap font-mono text-primary hover:underline"
      >
        {certificate.code}
      </Link>
      <span className={cn('block', CERTIFICATE_TONES[certificate.status])}>
        {certificate.status === 'expired'
          ? `Expired ${expires ?? ''}`.trim()
          : certificate.status === 'expiring_soon'
            ? `Expires ${expires ?? 'soon'}`
            : expires
              ? `Valid until ${expires}`
              : 'Valid'}
      </span>
    </>
  );
}
