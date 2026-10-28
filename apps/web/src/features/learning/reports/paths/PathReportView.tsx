import type { PathReportResponse, PathStatus } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { Link } from 'react-router';
import { apiPath } from '../../data';
import { csvHref, formatDay, personName, personReportHref } from '../people/data';
import { CELL, CsvLink, HEAD_CELL, None, ReportPage, ReportTable } from '../people/parts';
import { courseCount } from '../people/Transcript';

type Row = PathReportResponse['rows'][number];

const HEADINGS = ['Name', 'Status', 'Progress', 'Next course', 'Last activity', 'Completed'];

/** Each path status in words. */
const PATH_STATUS_LABELS: Record<PathStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  completed: 'Completed',
};

/** "1 person", "3 people". */
const peopleCount = (count: number): string => `${count} ${count === 1 ? 'person' : 'people'}`;

/**
 * A learning path's report: how many people are on it and how far they are, its courses in order,
 * and one line per person (status, courses finished, next course, last activity and when they
 * finished), linking to their learning record; the same as CSV. Days are in `timeZone`, the
 * viewer's profile time zone.
 */
export function PathReportView({
  report,
  timeZone,
}: {
  report: PathReportResponse;
  timeZone: string;
}) {
  const { path, courses, rows } = report;
  return (
    <ReportPage title={`${path.title} · Path report`}>
      <div className="flex flex-col gap-2">
        <p className="text-small text-muted">Path report</p>
        <h1 className="break-words text-title">{path.title}</h1>
        <p className="text-body text-muted">
          {[
            peopleCount(report.learners),
            `${report.completed} completed (${report.completionPercent}%)`,
            `${report.inProgress} in progress`,
            `${report.notStarted} not started`,
          ].join(' · ')}
        </p>
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="text-h3">Courses</h2>
        {courses.length === 0 ? (
          <p className="text-body text-muted">No courses on this path yet.</p>
        ) : (
          <ol className="list-decimal pl-6 text-body">
            {courses.map((course) => (
              <li key={course.id} className="break-words">
                {course.title}
              </li>
            ))}
          </ol>
        )}
      </section>
      <CsvLink href={csvHref(apiPath('reports', 'paths', path.id))} />
      {rows.length === 0 ? (
        <p className="text-body text-muted">Nobody is on this path yet.</p>
      ) : (
        <ReportTable caption={`People on ${path.title}`}>
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
              <PathLine key={row.learnerId} row={row} timeZone={timeZone} />
            ))}
          </tbody>
        </ReportTable>
      )}
    </ReportPage>
  );
}

/** One person on the path. */
function PathLine({ row, timeZone }: { row: Row; timeZone: string }) {
  return (
    <tr>
      <th scope="row" className={cn(CELL, 'font-medium')}>
        <Link
          to={personReportHref(row.learnerId)}
          className="break-words text-primary hover:underline"
        >
          {personName(row.learnerName)}
        </Link>
      </th>
      <td className={cn(CELL, row.status === 'completed' && 'text-success')}>
        {PATH_STATUS_LABELS[row.status]}
      </td>
      <td className={CELL}>
        {row.completed} of {courseCount(row.total)}
        <span className="block text-muted">{row.percent}%</span>
      </td>
      <td className={cn(CELL, 'break-words')}>{row.nextCourseTitle ?? <None />}</td>
      <td className={CELL}>{formatDay(row.lastActivityAt, timeZone) ?? <None />}</td>
      <td className={CELL}>{formatDay(row.completedAt, timeZone) ?? <None />}</td>
    </tr>
  );
}
