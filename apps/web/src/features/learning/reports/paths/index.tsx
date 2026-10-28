import { IdSchema, type Id } from '@carehub/learning';
import { useParams } from 'react-router';
import { LEARNING_DAY_ZONE, useProfileTimeZone } from '../../data/timeZone';
import { ScreenLoading } from '../../player/ScreenMessage';
import { ReportFailed, ReportNotFound } from '../people/parts';
import { usePathReport } from './data';
import { PathReportView } from './PathReportView';

/**
 * `/learning/reports/paths/:pathId`: how everyone on a learning path is getting on. Managers see
 * their own team's people on it, and people who may read reports see everyone (the server decides).
 */
export function PathReportScreen() {
  const pathId = IdSchema.safeParse(useParams().pathId);
  if (!pathId.success) return <ReportNotFound title="Path report" />;
  return <PathReport pathId={pathId.data} />;
}

function PathReport({ pathId }: { pathId: Id }) {
  const report = usePathReport(pathId);
  // The profile's zone, or the Learning day zone while /auth/me loads (decision 0317).
  const timeZone = useProfileTimeZone() ?? LEARNING_DAY_ZONE;
  if (report.data) return <PathReportView report={report.data} timeZone={timeZone} />;
  if (!report.error) return <ScreenLoading label="Loading the path report" />;
  return (
    <ReportFailed title="Path report" error={report.error} onRetry={() => void report.refetch()} />
  );
}
