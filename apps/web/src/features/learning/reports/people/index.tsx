import { IdSchema, type Id } from '@carehub/learning';
import { useParams } from 'react-router';
import { LEARNING_DAY_ZONE, useProfileTimeZone } from '../../data/timeZone';
import { ScreenLoading } from '../../player/ScreenMessage';
import { learningToday, usePersonTranscript } from './data';
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
  // The profile's zone, or the Learning day zone while /auth/me loads (decision 0317).
  const timeZone = useProfileTimeZone() ?? LEARNING_DAY_ZONE;
  if (transcript.data) {
    return (
      <TranscriptView transcript={transcript.data} today={learningToday()} timeZone={timeZone} />
    );
  }
  if (!transcript.error) return <ScreenLoading label="Loading the learning record" />;
  return (
    <ReportFailed
      title="Learning record"
      error={transcript.error}
      onRetry={() => void transcript.refetch()}
    />
  );
}
