import type { Id, TeamViewResponse } from '@carehub/learning';
import {
  cn,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@carehub/ui';
import { Link } from 'react-router';
import { apiPath } from '../../data';
import {
  csvHref,
  formatDay,
  formatMinutes,
  formatPercent,
  personName,
  personReportHref,
} from '../people/data';
import { CELL, CsvLink, HEAD_CELL, None, ReportPage, ReportTable } from '../people/parts';

type Group = TeamViewResponse['groups'][number];
type Member = TeamViewResponse['people'][number];

// The course filter's value for every course: course ids start with a letter or digit, never "_".
const ALL_COURSES = '_all';

const GROUP_HEADINGS = [
  'Group',
  'Learners',
  'Finished',
  'In progress',
  'Not started',
  'Failed',
  'Overdue',
  'Average score',
  'Average time',
];
const PEOPLE_HEADINGS = ['Name', 'Groups', 'Courses', 'Finished', 'Overdue', 'Last activity'];

/** "1 person", "3 people". */
const peopleCount = (count: number): string => `${count} ${count === 1 ? 'person' : 'people'}`;

/** "1 group", "3 groups". */
const groupCount = (count: number): string => `${count} ${count === 1 ? 'group' : 'groups'}`;

/** What the team view shows, and what its course filter does. */
export type TeamViewProps = {
  report: TeamViewResponse;
  /** The course the numbers cover; every course without one. */
  courseId: Id | undefined;
  onCourseChange(courseId: Id | undefined): void;
  /** The viewer's profile time zone, for the day of each person's last activity. */
  timeZone: string;
  /** The numbers on show are the last course's while the chosen one loads. */
  updating?: boolean;
};

/**
 * The team view: each group the viewer may see and how far its people are (finished, in progress,
 * not started, failed, overdue, average score and time), then one line per person, linking to
 * their learning record. A course filter narrows both, and the groups download as CSV.
 */
export function TeamView({
  report,
  courseId,
  onCourseChange,
  timeZone,
  updating = false,
}: TeamViewProps) {
  const { courses, groups, people } = report;
  const course = courses.find((candidate) => candidate.id === courseId);
  const groupNames = new Map(groups.map((group) => [group.groupId, group.groupName]));
  const covers = courseId === undefined ? 'All courses' : course?.title;
  return (
    <ReportPage title="Team learning">
      <div className="flex flex-col gap-2">
        <h1 className="text-title">Team learning</h1>
        <p className="text-body text-muted">
          {[peopleCount(people.length), groupCount(groups.length), covers]
            .filter(Boolean)
            .join(' · ')}
        </p>
        <p role="status" className="text-small text-muted">
          {updating ? 'Updating…' : ''}
        </p>
      </div>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <Field label="Course" className="md:w-72">
          <Select
            value={courseId === undefined ? ALL_COURSES : (course?.id ?? '')}
            onValueChange={(value) => onCourseChange(value === ALL_COURSES ? undefined : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Choose a course" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_COURSES}>All courses</SelectItem>
              {courses.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex">
          <CsvLink href={csvHref(apiPath('reports', 'team'), { courseId })} />
        </div>
      </div>
      {groups.length === 0 ? (
        <p className="text-body text-muted">
          No groups to show yet. A group shows here once you can see it and its people have courses.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-h3">Groups</h2>
            <ReportTable caption="Groups">
              <Headings names={GROUP_HEADINGS} />
              <tbody>
                {groups.map((group) => (
                  <GroupLine key={group.groupId} group={group} />
                ))}
              </tbody>
            </ReportTable>
          </section>
          <section className="flex flex-col gap-3">
            <h2 className="text-h3">People</h2>
            {people.length === 0 ? (
              <p className="text-body text-muted">Nobody in these groups has a course yet.</p>
            ) : (
              <ReportTable caption="People">
                <Headings names={PEOPLE_HEADINGS} />
                <tbody>
                  {people.map((person) => (
                    <PersonLine
                      key={person.id}
                      person={person}
                      groupNames={groupNames}
                      timeZone={timeZone}
                    />
                  ))}
                </tbody>
              </ReportTable>
            )}
          </section>
        </>
      )}
    </ReportPage>
  );
}

function Headings({ names }: { names: readonly string[] }) {
  return (
    <thead>
      <tr>
        {names.map((name) => (
          <th key={name} scope="col" className={HEAD_CELL}>
            {name}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** A count, in red when there is any. */
function Overdue({ count }: { count: number }) {
  return count > 0 ? <span className="text-danger">{count}</span> : <>0</>;
}

/** One group: its courses counted once per person and course. */
function GroupLine({ group }: { group: Group }) {
  const finished = group.completed + group.passed;
  return (
    <tr>
      <th scope="row" className={cn(CELL, 'break-words font-medium')}>
        {group.groupName}
      </th>
      <td className={CELL}>{group.learners}</td>
      <td className={CELL}>
        {formatPercent(group.completionPercent)}
        <span className="block text-muted">
          {finished} of {group.total}
        </span>
      </td>
      <td className={CELL}>{group.inProgress}</td>
      <td className={CELL}>{group.notStarted}</td>
      <td className={CELL}>{group.failed}</td>
      <td className={CELL}>
        <Overdue count={group.overdue} />
      </td>
      <td className={CELL}>{formatPercent(group.averageScore) ?? <None />}</td>
      <td className={CELL}>
        {group.averageActiveSeconds === null ? <None /> : formatMinutes(group.averageActiveSeconds)}
      </td>
    </tr>
  );
}

/** One person: their groups, courses, finished and overdue courses and last activity. */
function PersonLine({
  person,
  groupNames,
  timeZone,
}: {
  person: Member;
  groupNames: ReadonlyMap<Id, string>;
  timeZone: string;
}) {
  const names = person.groupIds.flatMap((id) => groupNames.get(id) ?? []);
  return (
    <tr>
      <th scope="row" className={cn(CELL, 'font-medium')}>
        <Link to={personReportHref(person.id)} className="break-words text-primary hover:underline">
          {personName(person.name)}
        </Link>
      </th>
      <td className={cn(CELL, 'break-words')}>{names.length > 0 ? names.join(', ') : <None />}</td>
      <td className={CELL}>{person.courses}</td>
      <td className={CELL}>{person.finished}</td>
      <td className={CELL}>
        <Overdue count={person.overdue} />
      </td>
      <td className={CELL}>{formatDay(person.lastActivityAt, timeZone) ?? <None />}</td>
    </tr>
  );
}
