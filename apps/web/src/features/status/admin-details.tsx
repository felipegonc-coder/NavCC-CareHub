import { Button, Card, CardDescription, CardHeader, CardTitle, Skeleton, cn } from '@carehub/ui';
import { CircleCheck, CircleDashed, CircleX, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  useAskForBackup,
  useStatusDetails,
  type BackupAsk,
  type PartDetails,
  type StatusDetails,
  type Viewer,
} from './api';
import { minutesText, sizeText, timeText } from './format';

const PART_NAMES: Record<PartDetails['part'], string> = {
  server: 'Web app and server',
  database: 'Database',
  files: 'File storage',
  collab: 'Live editing',
  jobs: 'Background jobs (reminders and automations)',
  calendar: 'Calendar sync',
};

const STATES = {
  ok: { word: 'Working', Icon: CircleCheck, tone: 'text-success' },
  problem: { word: 'Problem', Icon: TriangleAlert, tone: 'text-warning' },
  down: { word: 'Down', Icon: CircleX, tone: 'text-danger' },
  unknown: { word: 'Not checked', Icon: CircleDashed, tone: 'text-muted' },
} as const;

const CAUSES: Record<StatusDetails['incidents'][number]['cause'], string> = {
  update: 'Update',
  restart: 'Restart',
  unknown: 'Unknown cause',
};

const ASKED: Record<BackupAsk, string> = {
  backup: 'Backup asked for. It starts within a minute; the result shows here when it ends.',
  restore_test:
    'Restore test asked for. Every backup ends with one, so a backup starts within a minute.',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-small text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** The part's message, then its facts: free disk space, or failing calendar connections. */
function partDetail({ part, message, facts }: PartDetails): string | null {
  const { freeBytes, totalBytes, connections, failing } = facts;
  let fact: string | null = null;
  if (part === 'files' && typeof freeBytes === 'number' && typeof totalBytes === 'number') {
    const share = Math.round((freeBytes / totalBytes) * 100);
    fact = `${share}% of the disk free (${sizeText(freeBytes)} of ${sizeText(totalBytes)}).`;
  }
  if (part === 'calendar' && typeof failing === 'number' && typeof connections === 'number') {
    fact =
      failing === 0
        ? 'No calendar connections failing.'
        : `${failing} of ${connections} calendar connections failing.`;
  }
  if (!fact) return message;
  return message ? `${message} ${fact}` : fact;
}

function Parts({ parts }: { parts: StatusDetails['parts'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Parts</CardTitle>
      </CardHeader>
      <ul className="mt-2 flex flex-col divide-y divide-border">
        {parts.map((part) => {
          const { word, Icon, tone } = STATES[part.state];
          const detail = partDetail(part);
          return (
            <li key={part.part} className="flex flex-col gap-1 py-3 sm:flex-row sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{PART_NAMES[part.part]}</span>
                {detail && <span className="text-small text-muted">{detail}</span>}
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-small">
                <Icon aria-hidden className={cn('size-4', tone)} />
                {word}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Backups({ backups, viewer }: { backups: StatusDetails['backups']; viewer: Viewer }) {
  const ask = useAskForBackup();
  const { lastGood, latest, lastRestoreTest } = backups;
  const when = (iso: string) => timeText(iso, viewer);
  return (
    <Card className="flex flex-col gap-4">
      <CardHeader>
        <CardTitle as="h2">Backups</CardTitle>
        {!backups.setUp && <CardDescription>Backups aren't set up on this server.</CardDescription>}
        {backups.setUp && !latest && (
          <CardDescription>No backups yet. The first one runs tonight.</CardDescription>
        )}
      </CardHeader>
      <dl className="flex flex-col gap-3">
        {latest && !latest.ok && (
          <Row label="Latest backup">
            <span className="flex items-center gap-1.5">
              <CircleX aria-hidden className="size-4 shrink-0 text-danger" />
              Failed on {when(latest.at)}
              {latest.reason && `: ${latest.reason}`}
            </span>
          </Row>
        )}
        <Row label="Last good backup">
          {lastGood
            ? `${when(lastGood.at)}${lastGood.sizeBytes === null ? '' : ` · ${sizeText(lastGood.sizeBytes)}`}`
            : 'None yet'}
        </Row>
        <Row label="Last restore test">
          {lastRestoreTest ? (
            <>
              {lastRestoreTest.ok ? 'Passed' : 'Failed'} on {when(lastRestoreTest.at)}
              {lastRestoreTest.details && (
                <span className="block text-small text-muted">{lastRestoreTest.details}</span>
              )}
            </>
          ) : (
            'None yet'
          )}
        </Row>
        {backups.setUp && <Row label="Next backup">{when(backups.next)}</Row>}
      </dl>
      <div className="flex flex-wrap gap-2">
        {(['backup', 'restore_test'] as const).map((kind) => (
          <Button
            key={kind}
            variant="secondary"
            loading={ask.isPending && ask.variables === kind}
            onClick={() => ask.mutate(kind)}
          >
            {kind === 'backup' ? 'Back up now' : 'Test a restore now'}
          </Button>
        ))}
      </div>
      <p role="status" className={cn('text-small', ask.isError && 'text-danger')}>
        {ask.isError && ask.error.message}
        {ask.isSuccess && ASKED[ask.data]}
        {ask.isIdle && backups.requested && 'A backup was asked for. It starts within a minute.'}
      </p>
    </Card>
  );
}

function Incidents({ incidents, viewer }: Pick<StatusDetails, 'incidents'> & { viewer: Viewer }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Incidents</CardTitle>
        {incidents.length === 0 && (
          <CardDescription>No incidents in the last 30 days.</CardDescription>
        )}
      </CardHeader>
      {incidents.length > 0 && (
        <ul className="mt-2 flex flex-col divide-y divide-border">
          {incidents.map((incident) => (
            <li
              key={incident.start}
              className="flex flex-col gap-0.5 py-3 sm:flex-row sm:justify-between"
            >
              <span>
                {timeText(incident.start, viewer)} to {timeText(incident.end, viewer)}
              </span>
              <span className="text-small text-muted">
                {minutesText(incident.minutes)} · {CAUSES[incident.cause]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Version({ version, viewer }: Pick<StatusDetails, 'version'> & { viewer: Viewer }) {
  const when = (iso: string | null) => (iso ? timeText(iso, viewer) : 'Not recorded');
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader>
        <CardTitle as="h2">Version</CardTitle>
      </CardHeader>
      <dl className="flex flex-col gap-3">
        <Row label="Number">{version.number}</Row>
        <Row label="Build date">{when(version.buildDate)}</Row>
        <Row label="Last update">{when(version.updatedAt)}</Row>
      </dl>
    </Card>
  );
}

/** What only site admins see: each part, backups, incidents and the version (ST-02). */
export function AdminDetails({ viewer }: { viewer: Viewer }) {
  const details = useStatusDetails();
  if (details.isPending) {
    return (
      <div role="status" aria-label="Loading the details" className="flex flex-col gap-4">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (details.isError) {
    return (
      <p role="alert" className="text-danger">
        {details.error.message}
      </p>
    );
  }
  const { parts, backups, incidents, version } = details.data;
  return (
    <>
      <Parts parts={parts} />
      <Backups backups={backups} viewer={viewer} />
      <Incidents incidents={incidents} viewer={viewer} />
      <Version version={version} viewer={viewer} />
    </>
  );
}
