import type { Id } from '@carehub/learning';
import { Button, Card } from '@carehub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { LEARNING_DAY_ZONE, useProfileTimeZone } from '../../data/timeZone';
import { useStudioClient } from '../context';
import { studioKeys } from '../data/queries';
import { ErrorState, LoadingState } from '../states';

/** Props for {@link VersionsPanel}. */
export type VersionsPanelProps = {
  courseId: Id;
  /** Saves what is waiting first, so nothing typed is lost before the draft is replaced. */
  flush(): Promise<unknown>;
  /** The old version was published again as `version`; load the draft (now that version) in the editor. */
  onRolledBack(version: number): Promise<void>;
  onClose(): void;
};

/** Published versions, newest first, each with roll back (published again as a new version). */
export function VersionsPanel(props: VersionsPanelProps): JSX.Element {
  const headingId = useId();
  const client = useStudioClient();
  const queryClient = useQueryClient();
  // When each version was published, in the person's profile zone (decision 0317).
  const timeZone = useProfileTimeZone() ?? LEARNING_DAY_ZONE;
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone }),
    [timeZone],
  );
  const [confirming, setConfirming] = useState<number | null>(null);
  const versions = useQuery({
    queryKey: studioKeys.versions(props.courseId),
    queryFn: () => client.listVersions(props.courseId),
  });
  const list = versions.data ?? [];
  const rollback = useMutation({
    mutationFn: async (version: number) => {
      await props.flush();
      return client.rollback(props.courseId, version);
    },
    onSuccess: async ({ version }) => {
      setConfirming(null);
      void queryClient.invalidateQueries({ queryKey: studioKeys.versions(props.courseId) });
      void queryClient.invalidateQueries({ queryKey: studioKeys.courseLists });
      await props.onRolledBack(version);
    },
  });

  return (
    <Card role="region" aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="text-body font-semibold text-fg">
          Versions
        </h2>
        <Button size="sm" variant="ghost" onClick={props.onClose}>
          Close
        </Button>
      </div>
      {versions.isPending ? (
        <LoadingState label="Loading versions" />
      ) : versions.isError ? (
        <ErrorState error={versions.error} onRetry={() => void versions.refetch()} />
      ) : list.length === 0 ? (
        <p className="text-small text-muted">Not published yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {list.map((item, index) => (
            <li
              key={item.version}
              className="flex flex-wrap items-center gap-2 rounded border border-border p-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-small font-semibold text-fg">
                  Version {item.version}
                  {index === 0 && <span className="font-normal text-muted"> · Live</span>}
                </p>
                <p className="text-small text-muted">
                  {dateFormat.format(new Date(item.publishedAt))} · {item.title}
                  {item.note ? ` · ${item.note}` : ''}
                </p>
              </div>
              {index > 0 &&
                (confirming === item.version ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-small text-fg">
                      Publish version {item.version} again? Your draft becomes that version.
                    </span>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={rollback.isPending}
                      onClick={() => rollback.mutate(item.version)}
                    >
                      Roll back
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => setConfirming(item.version)}>
                    Roll back to version {item.version}
                  </Button>
                ))}
            </li>
          ))}
        </ol>
      )}
      {rollback.isError && (
        <p role="alert" className="text-small text-danger">
          Rolling back didn't work. Try again.
        </p>
      )}
    </Card>
  );
}
