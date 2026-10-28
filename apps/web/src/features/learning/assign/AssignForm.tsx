import { ASSIGNMENT_LIMITS, learningToday } from '@carehub/learning';
import { Button, Checkbox, Field, Input, useFieldControlProps } from '@carehub/ui';
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from 'react';
import { LearningApiError } from '../data';
import {
  useCourseOptions,
  useCreateAssignments,
  useGroups,
  usePathOptions,
  usePeople,
  type Group,
} from './data';
import {
  countText,
  emptyDraft,
  errorsFromIssues,
  FIELD_ORDER,
  findPeople,
  requestFrom,
  targetValue,
  type AssignDraft,
  type DraftErrors,
  type DraftField,
  type DueChoice,
} from './form';

// The new-assignment form: a course or path, people and groups, when it's due, and whether it's
// required. The server checks everything again; its messages show at the field they're about.

const selectClasses = [
  'flex h-9 w-full rounded border border-border bg-bg px-3 text-small text-fg transition-colors',
  'hover:border-border-hover disabled:cursor-not-allowed disabled:bg-fill disabled:text-faint',
  'aria-[invalid=true]:border-danger max-md:h-11',
].join(' ');

/**
 * A native select wired to its <Field>: easy to use with a keyboard, a phone or a screen reader.
 */
function NativeSelect(props: ComponentProps<'select'>) {
  const field = useFieldControlProps(props);
  return <select className={selectClasses} {...props} {...field} />;
}

/** People to show in the list at once; search finds the others. */
const SHOWN_PEOPLE = 50;

type ChoiceListProps = {
  legend: string;
  children: ReactNode;
  describedBy?: string | undefined;
};

function ChoiceList({ legend, children, describedBy }: ChoiceListProps) {
  return (
    <fieldset aria-describedby={describedBy} className="flex min-w-0 flex-col gap-2">
      <legend className="mb-1 text-small font-medium text-fg">{legend}</legend>
      {children}
    </fieldset>
  );
}

type ChoiceProps = {
  checked: boolean;
  onChange(checked: boolean): void;
  label: string;
  detail?: string | undefined;
};

const choiceClasses =
  'flex min-h-9 cursor-pointer items-center gap-2 text-small text-fg max-md:min-h-11';

function Choice({ checked, onChange, label, detail }: ChoiceProps) {
  return (
    <li>
      <label className={choiceClasses}>
        <Checkbox checked={checked} onCheckedChange={(value) => onChange(value === true)} />
        <span>{label}</span>
        {detail && (
          <span className="text-muted">
            <span className="sr-only">, </span>
            {detail}
          </span>
        )}
      </label>
    </li>
  );
}

const toggled = (ids: readonly string[], id: string, on: boolean) =>
  on ? [...new Set([...ids, id])] : ids.filter((other) => other !== id);

export type AssignFormProps = {
  /** Says what happened, in the screen's status line. */
  onAssigned(message: string): void;
};

export function AssignForm({ onAssigned }: AssignFormProps) {
  const courses = useCourseOptions();
  const paths = usePathOptions();
  const people = usePeople();
  const groups = useGroups();
  const create = useCreateAssignments();
  const [draft, setDraft] = useState<AssignDraft>(emptyDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const headingId = useId();
  const whoErrorId = useId();
  const refs = {
    target: useRef<HTMLSelectElement>(null),
    who: useRef<HTMLInputElement>(null),
    dueDate: useRef<HTMLInputElement>(null),
    dueInDays: useRef<HTMLInputElement>(null),
  } satisfies Record<DraftField, unknown>;
  // The earliest due date: today in Learning's day zone (decision 0317), as the server checks it.
  const today = learningToday();

  const update = (change: Partial<AssignDraft>) =>
    setDraft((current) => ({ ...current, ...change }));

  function show(found: DraftErrors) {
    setErrors(found);
    const first = FIELD_ORDER.find((field) => found[field] !== undefined);
    if (first) refs[first].current?.focus();
  }

  const courseList = courses.data ?? [];
  const pathList = paths.data ?? [];
  /** The chosen course's or path's title, for the status line. */
  const chosenTitle = () => {
    const all = [
      ...courseList.map((course) => ({ value: targetValue('course', course.id), ...course })),
      ...pathList.map((path) => ({ value: targetValue('path', path.id), ...path })),
    ];
    return all.find((option) => option.value === draft.target)?.title ?? 'the course';
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) return;
    setProblem(null);
    const result = requestFrom(draft, today);
    if ('errors' in result) return show(result.errors);
    try {
      await create.mutateAsync(result.request);
      const who = countText(draft.people.length, draft.groups.length);
      onAssigned(`Assigned "${chosenTitle()}" to ${who}.`);
      setDraft(emptyDraft);
      setErrors({});
      setQuery('');
    } catch (error) {
      if (error instanceof LearningApiError && error.issues.length > 0) {
        const { errors: found, other } = errorsFromIssues(error.issues);
        if (other.length > 0) setProblem(other.join(' '));
        show(found);
      } else {
        setProblem(error instanceof Error ? error.message : 'Something went wrong. Try again.');
      }
    }
  }

  // Guests can't take courses yet (the Learning API refuses them), so they aren't offered.
  const members = useMemo(() => people.data?.filter((person) => !person.isGuest), [people.data]);
  const found = members ? findPeople(members, query) : [];
  const nothingToAssign =
    courses.data !== undefined &&
    paths.data !== undefined &&
    courseList.length + pathList.length === 0;
  let targetHint: string | undefined;
  if (courses.loading || paths.isPending) targetHint = 'Loading courses…';
  else if (courses.error) targetHint = "The courses didn't load. Reload the page to try again.";
  else if (nothingToAssign)
    targetHint = 'Nothing is published yet. Publish a course in the Studio first.';

  return (
    <form
      noValidate
      aria-labelledby={headingId}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-6"
    >
      <h2 id={headingId} className="text-h2 text-fg">
        New assignment
      </h2>
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
      <Field label="Course or path" required hint={targetHint} error={errors.target}>
        <NativeSelect
          ref={refs.target}
          value={draft.target}
          onChange={(event) => update({ target: event.target.value })}
        >
          <option value="">Choose a course or path</option>
          {courseList.length > 0 && (
            <optgroup label="Courses">
              {courseList.map((course) => (
                <option key={course.id} value={targetValue('course', course.id)}>
                  {course.listed ? course.title : `${course.title} (not in the catalog)`}
                </option>
              ))}
            </optgroup>
          )}
          {pathList.length > 0 && (
            <optgroup label="Learning paths">
              {pathList.map((path) => (
                <option key={path.id} value={targetValue('path', path.id)}>
                  {`${path.title} (learning path)`}
                </option>
              ))}
            </optgroup>
          )}
        </NativeSelect>
      </Field>

      <div className="grid gap-6 md:grid-cols-2">
        <ChoiceList legend="People" describedBy={errors.who ? whoErrorId : undefined}>
          {people.data === null && (
            <p className="text-small text-muted">Care Hub can't list the people here yet.</p>
          )}
          {people.data === undefined && (
            <p className="text-small text-muted">
              {people.error
                ? "The people didn't load. Reload the page to try again."
                : 'Loading people…'}
            </p>
          )}
          {members && (
            <>
              <Input
                ref={refs.who}
                type="search"
                aria-label="Find people"
                aria-describedby={errors.who ? whoErrorId : undefined}
                aria-invalid={errors.who ? true : undefined}
                placeholder="Name or email"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ul className="flex max-h-72 flex-col overflow-y-auto">
                {found.slice(0, SHOWN_PEOPLE).map((person) => (
                  <Choice
                    key={person.id}
                    label={person.name}
                    detail={person.email}
                    checked={draft.people.includes(person.id)}
                    onChange={(on) => update({ people: toggled(draft.people, person.id, on) })}
                  />
                ))}
              </ul>
              <p className="text-small text-muted">
                {found.length === 0
                  ? 'No one matches. Check the spelling, or search by email.'
                  : found.length > SHOWN_PEOPLE
                    ? `Showing ${SHOWN_PEOPLE} of ${found.length}. Search to find others.`
                    : `${draft.people.length} chosen`}
              </p>
            </>
          )}
        </ChoiceList>

        <ChoiceList legend="Groups" describedBy={errors.who ? whoErrorId : undefined}>
          <GroupChoices
            groups={groups.data}
            failed={Boolean(groups.error)}
            chosen={draft.groups}
            onChange={(ids) => update({ groups: ids })}
          />
        </ChoiceList>
      </div>
      {errors.who && (
        <p id={whoErrorId} className="-mt-4 text-small text-danger">
          {errors.who}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Due date">
          <NativeSelect
            value={draft.due}
            onChange={(event) => update({ due: event.target.value as DueChoice })}
          >
            <option value="none">No due date</option>
            <option value="date">On a day</option>
            <option value="days">A number of days after it's assigned</option>
          </NativeSelect>
        </Field>
        {draft.due === 'date' && (
          <Field label="Due on" required error={errors.dueDate}>
            <Input
              ref={refs.dueDate}
              type="date"
              min={today}
              value={draft.dueDate}
              onChange={(event) => update({ dueDate: event.target.value })}
            />
          </Field>
        )}
        {draft.due === 'days' && (
          <Field
            label="Days to finish"
            required
            hint="Counted from the day each person gets the course."
            error={errors.dueInDays}
          >
            <Input
              ref={refs.dueInDays}
              type="number"
              inputMode="numeric"
              min={1}
              max={ASSIGNMENT_LIMITS.dueInDays}
              value={draft.dueInDays}
              onChange={(event) => update({ dueInDays: event.target.value })}
            />
          </Field>
        )}
      </div>

      <Field
        label="Required"
        layout="inline"
        hint="People get reminders until they finish. Optional courses get only the first notice."
      >
        <Checkbox
          checked={draft.required}
          onCheckedChange={(value) => update({ required: value === true })}
        />
      </Field>

      <div>
        <Button type="submit" loading={create.isPending}>
          Assign
        </Button>
      </div>
    </form>
  );
}

type GroupChoicesProps = {
  groups: Group[] | null | undefined;
  failed: boolean;
  chosen: readonly string[];
  onChange(ids: string[]): void;
};

function GroupChoices({ groups, failed, chosen, onChange }: GroupChoicesProps) {
  if (groups === null) {
    return <p className="text-small text-muted">Care Hub can't list the groups here yet.</p>;
  }
  if (groups === undefined) {
    return (
      <p className="text-small text-muted">
        {failed ? "The groups didn't load. Reload the page to try again." : 'Loading groups…'}
      </p>
    );
  }
  if (groups.length === 0) {
    return (
      <p className="text-small text-muted">There are no groups yet. Admins add them in Settings.</p>
    );
  }
  return (
    <ul className="flex max-h-72 flex-col overflow-y-auto">
      {groups.map((group) => (
        <Choice
          key={group.id}
          label={group.name}
          detail={`${group.memberIds.length} ${group.memberIds.length === 1 ? 'person' : 'people'}`}
          checked={chosen.includes(group.id)}
          onChange={(on) => onChange(toggled(chosen, group.id, on))}
        />
      ))}
    </ul>
  );
}
