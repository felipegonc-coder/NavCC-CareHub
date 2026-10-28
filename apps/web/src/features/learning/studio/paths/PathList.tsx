import { LIMITS, type PathSummary } from '@carehub/learning';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
} from '@carehub/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { LoadingState } from '../states';
import { ORDER_LABELS, pathEditorPath, pathErrorText, useCreatePath, useStudioPaths } from './data';
import { BackLink, PathError } from './parts';

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

/** "1 course" or "3 courses". */
export const coursesText = (count: number): string =>
  count === 1 ? '1 course' : `${count} courses`;

function NewPathForm() {
  const navigate = useNavigate();
  const create = useCreatePath();
  const [title, setTitle] = useState('');
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          { title: title.trim() || 'Untitled path' },
          { onSuccess: (path) => void navigate(pathEditorPath(path.id)) },
        );
      }}
    >
      <Field label="Title" hint="You can change it later.">
        <Input
          value={title}
          maxLength={LIMITS.title}
          placeholder="Untitled path"
          onChange={(event) => setTitle(event.currentTarget.value)}
        />
      </Field>
      {create.isError && (
        <p role="alert" className="text-small text-danger">
          {`The path wasn't created. ${pathErrorText(create.error)}`}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost">Cancel</Button>
        </DialogClose>
        <Button type="submit" loading={create.isPending}>
          Create path
        </Button>
      </DialogFooter>
    </form>
  );
}

/** New path: a dialog asking for a title, then the new path opens in the builder. */
function NewPathButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          New path
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New learning path</DialogTitle>
          <DialogDescription>
            A path is a set of courses people take together, such as a new starter's first weeks.
            You add the courses next.
          </DialogDescription>
        </DialogHeader>
        <NewPathForm />
      </DialogContent>
    </Dialog>
  );
}

function PathRow({ path }: { path: PathSummary }) {
  return (
    <li className="flex flex-col gap-1 rounded border border-border p-4">
      <Link
        to={pathEditorPath(path.id)}
        className="self-start text-body font-semibold text-fg hover:underline"
      >
        {path.title}
      </Link>
      <p className="text-small text-muted">
        {`${coursesText(path.courseCount)} · ${ORDER_LABELS[path.order]} · Edited `}
        {dateFormat.format(new Date(path.updatedAt))}
      </p>
    </li>
  );
}

/** `/learning/studio/paths`: the workspace's learning paths, newest change first, and New path. */
export function PathList() {
  const paths = useStudioPaths();
  const list = paths.data ?? [];
  // After a delete, the builder comes back here with what it did (router state).
  const state: unknown = useLocation().state;
  const done =
    typeof state === 'object' && state !== null && 'done' in state && typeof state.done === 'string'
      ? state.done
      : '';
  return (
    <main className="mx-auto flex max-w-page flex-col gap-6 px-6 py-8">
      <title>Care Hub · Learning paths</title>
      <BackLink to="/learning/studio">Studio</BackLink>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-title text-fg">Learning paths</h1>
          <p className="text-small text-muted">
            Courses to take together, in order or in any order.
          </p>
        </div>
        <NewPathButton />
      </div>
      <p role="status" className="text-small text-muted">
        {done}
      </p>
      {paths.isPending ? (
        <LoadingState label="Loading learning paths" />
      ) : paths.isError ? (
        <PathError error={paths.error} onRetry={() => void paths.refetch()} />
      ) : list.length === 0 ? (
        <p className="text-body text-muted">No learning paths yet. Start one with New path.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.map((path) => (
            <PathRow key={path.id} path={path} />
          ))}
        </ul>
      )}
    </main>
  );
}
