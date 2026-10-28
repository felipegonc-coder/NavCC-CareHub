import { IdSchema, type Id } from '@carehub/learning';
import { useSearchParams } from 'react-router';
import { LEARNING_DAY_ZONE, useProfileTimeZone } from '../../data/timeZone';
import { ScreenLoading } from '../../player/ScreenMessage';
import { ReportFailed, ReportNotFound } from '../people/parts';
import { useTeamView } from './data';
import { TeamView } from './TeamView';

/**
 * `/learning/reports/team[?courseId=]`: the team view. Managers see their own team, and people who
 * may read reports see every group (the server decides).
 */
export function TeamReportScreen() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('courseId');
  const courseId = raw === null ? undefined : IdSchema.safeParse(raw);
  if (courseId !== undefined && !courseId.success) return <ReportNotFound title="Team learning" />;
  return (
    <TeamReport
      courseId={courseId?.data}
      onCourseChange={(next) => setParams(next === undefined ? {} : { courseId: next })}
    />
  );
}

function TeamReport({
  courseId,
  onCourseChange,
}: {
  courseId: Id | undefined;
  onCourseChange(courseId: Id | undefined): void;
}) {
  const report = useTeamView(courseId);
  // The profile's zone, or the Learning day zone while /auth/me loads (decision 0317).
  const timeZone = useProfileTimeZone() ?? LEARNING_DAY_ZONE;
  if (report.data) {
    return (
      <TeamView
        report={report.data}
        courseId={courseId}
        onCourseChange={onCourseChange}
        timeZone={timeZone}
        updating={report.isPlaceholderData}
      />
    );
  }
  if (!report.error) return <ScreenLoading label="Loading team learning" />;
  return (
    <ReportFailed
      title="Team learning"
      error={report.error}
      onRetry={() => void report.refetch()}
    />
  );
}
