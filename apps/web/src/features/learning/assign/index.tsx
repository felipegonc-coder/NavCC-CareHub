import { ErrorState, LoadingState, NoAccessState } from '@carehub/ui';
import { useMemo, useState } from 'react';
import { LearningApiError } from '../data';
import { AssignForm } from './AssignForm';
import { AssignmentList } from './AssignmentList';
import { useAssignments, useGroups, usePathOptions, usePeople } from './data';
import { entriesOf, type Names } from './entries';

// The Assign screen: assign courses and learning paths to people and groups, and see and
// remove what's assigned. Only people who may assign (learning.assign) get past the first call.

/** `/learning/assign`: assigning courses and paths to people and groups. */
export function AssignScreen() {
  const assignments = useAssignments();
  const people = usePeople();
  const groups = useGroups();
  const paths = usePathOptions();
  const [status, setStatus] = useState('');
  const entries = useMemo(() => entriesOf(assignments.data ?? []), [assignments.data]);
  const names = useMemo<Names>(
    () => ({
      people: people.data ? new Map(people.data.map((person) => [person.id, person.name])) : null,
      groups: groups.data ? new Map(groups.data.map((group) => [group.id, group.name])) : null,
    }),
    [people.data, groups.data],
  );
  const pathTitles = useMemo(
    () => new Map((paths.data ?? []).map((path) => [path.id, path.title])),
    [paths.data],
  );

  let content;
  if (assignments.data) {
    content = (
      <>
        <AssignForm onAssigned={setStatus} />
        <AssignmentList
          entries={entries}
          names={names}
          pathTitles={pathTitles}
          onRemoved={setStatus}
        />
      </>
    );
  } else if (assignments.error) {
    const { error } = assignments;
    content =
      error instanceof LearningApiError && error.status === 403 ? (
        // Only people who may assign get this far; the rest see why, and nothing of the screen.
        <NoAccessState role="alert" />
      ) : (
        <ErrorState
          message={
            error instanceof LearningApiError ? error.message : "The assignments didn't load."
          }
          retrying={assignments.isFetching}
          onRetry={() => void assignments.refetch()}
        />
      );
  } else {
    content = <LoadingState label="Loading assignments" />;
  }

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-8 px-6 py-16">
      <title>Care Hub · Assign</title>
      <div className="flex flex-col gap-2">
        <h1 className="text-title text-fg">Assign</h1>
        <p className="text-body text-muted">
          Give people and groups courses and learning paths to take, with a due date if you like.
        </p>
        <p role="status" className="text-small text-fg">
          {status}
        </p>
      </div>
      {content}
    </main>
  );
}
