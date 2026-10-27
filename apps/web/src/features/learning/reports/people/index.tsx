import { IdSchema, type Id } from '@carehub/learning';
import { useParams } from 'react-router';
import { ScreenLoading } from '../../player/ScreenMessage';
import { browserToday, usePersonTranscript } from './data';
import { ReportFailed, ReportNotFound } from './parts';
import { TranscriptView } from './Transcript';

/**
 * `/learning/reports/people/:personId`: one person's learning record. People see their own; seeing
 * someone else's takes learning.analytics or being their manager (the server decides).
 */
export function PersonReportScreen() {
  const personId = IdSchema.safeParse(useParams().personId);
  if (!personId.success) return <ReportNotFound title="Learning record" />;
  return <PersonReport personId={personId.data} />;
}

function PersonReport({ personId }: { personId: Id }) {
  const transcript = usePersonTranscript(personId);
  if (transcript.data)
    return <TranscriptView transcript={transcript.data} today={browserToday()} />;
  if (!transcript.error) return <ScreenLoading label="Loading the learning record" />;
  return (
    <ReportFailed
      title="Learning record"
      error={transcript.error}
      onRetry={() => void transcript.refetch()}
    />
  );
}
