import type { Assignment, PathSummary } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../catalog/data';
import { LEARNING_DAY_ZONE } from '../data/timeZone';
import { formatDay, formatDueDate } from '../home/entry';
import { errorReply, jsonReply, renderRoute } from '../player/test-utils';
import type { StudioCourse } from './form';
import { AssignScreen } from './index';

// Fictional people and courses only. GET /api/auth/me isn't served (404), so days show in
// America/Denver: Learning's day zone, and the profile default.
const DANA = '00000000-0000-4000-8000-00000000000a';
const TARA = '00000000-0000-4000-8000-00000000000b';
const OMAR = '00000000-0000-4000-8000-00000000000c';
const GWEN = '00000000-0000-4000-8000-00000000000d';
const FRONT_DESK = 'group-front-desk';
const CALLS = { id: 'course-calls-with-care', title: 'Handling calls with care' };
const PRIVACY = { id: 'course-privacy-basics', title: 'Privacy basics' };
const MADE_AT = '2026-10-20T15:00:00.000Z';

const catalog: CatalogEntry[] = [{ ...CALLS, type: 'standard', lessonCount: 3, version: 1 }];
const members = [
  { id: DANA, name: 'Dana Reyes', email: 'dana@example.org' },
  { id: TARA, name: 'Tara Okafor', email: 'tara@example.org' },
  { id: OMAR, name: 'Omar Haddad', email: 'omar@example.org' },
  { id: GWEN, name: 'Gwen Ito', email: 'gwen@example.org', isGuest: true },
];
const groups = [{ id: FRONT_DESK, name: 'Front desk', memberIds: [OMAR] }];

const assignment = (change: Partial<Assignment> = {}): Assignment => ({
  id: '10000000-0000-4000-8000-000000000001',
  courseId: CALLS.id,
  courseTitle: CALLS.title,
  pathId: null,
  people: [TARA],
  groups: [],
  dueDate: null,
  dueInDays: null,
  required: true,
  createdBy: DANA,
  createdAt: MADE_AT,
  ...change,
});

type Issue = { path: string; message: string };
type World = {
  assignments: Assignment[];
  /** The status of GET /assignments. */
  list: number;
  members: number;
  groups: number;
  studio: StudioCourse[] | null;
  paths: PathSummary[] | null;
  /** What POST /assignments says is wrong, if anything. */
  issues: Issue[];
};
type Sent = {
  target: { type: 'course' | 'path'; id: string };
  people: string[];
  groups: string[];
  dueDate?: string;
  dueInDays?: number;
  required: boolean;
};

/**
 * A fake Learning API and core's members and groups on `fetch`. Assigning adds rows the way the
 * server does (a path gives one per course); null for `studio` or `paths` is a 403.
 */
function serveAssign(change: Partial<World> = {}) {
  const world: World = {
    assignments: [],
    list: 200,
    members: 200,
    groups: 200,
    studio: null,
    paths: null,
    issues: [],
    ...change,
  };
  const sent: Sent[] = [];
  const removed: string[] = [];
  let made = 1;
  const id = () => `10000000-0000-4000-8000-${String((made += 1)).padStart(12, '0')}`;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/learning/assignments' && method === 'POST') {
      const request = JSON.parse(String(init?.body)) as Sent;
      sent.push(request);
      if (world.issues.length > 0) {
        const error = { code: 'invalid', message: 'Check the assignment.', issues: world.issues };
        return jsonReply(400, { error });
      }
      const courses =
        request.target.type === 'path'
          ? [CALLS, PRIVACY]
          : [CALLS, PRIVACY].filter((course) => course.id === request.target.id);
      const rows = courses.map((course) =>
        assignment({
          id: id(),
          courseId: course.id,
          courseTitle: course.title,
          pathId: request.target.type === 'path' ? request.target.id : null,
          people: request.people,
          groups: request.groups,
          dueDate: request.dueDate ?? null,
          dueInDays: request.dueInDays ?? null,
          required: request.required,
          createdAt: '2026-10-27T15:00:00.000Z',
        }),
      );
      world.assignments = [...world.assignments, ...rows];
      return jsonReply(201, rows);
    }
    const removing = /^\/api\/learning\/assignments\/([^/]+)$/.exec(url);
    if (removing && method === 'DELETE') {
      removed.push(removing[1] ?? '');
      world.assignments = world.assignments.filter((row) => row.id !== removing[1]);
      return new Response(null, { status: 204 });
    }
    const replies: Record<string, () => Response> = {
      '/api/learning/assignments': () =>
        world.list === 200 ? jsonReply(200, world.assignments) : errorReply(world.list),
      '/api/learning/catalog': () => jsonReply(200, catalog),
      '/api/learning/studio/courses': () =>
        world.studio ? jsonReply(200, world.studio) : errorReply(403),
      '/api/learning/studio/paths': () =>
        world.paths ? jsonReply(200, world.paths) : errorReply(403),
      '/api/workspace/members': () =>
        world.members === 200 ? jsonReply(200, members) : errorReply(world.members),
      '/api/workspace/groups': () =>
        world.groups === 200 ? jsonReply(200, groups) : errorReply(world.groups),
    };
    return replies[url]?.() ?? errorReply(404);
  });
  return { world, sent, removed };
}

const show = () => renderRoute('/learning/assign', { '/learning/assign': <AssignScreen /> });
const target = () => screen.getByRole('combobox', { name: 'Course or path' });
const choose = (value: string) => fireEvent.change(target(), { target: { value } });
const assignButton = () => screen.getByRole('button', { name: 'Assign' });

/** The screen once its lists are in. */
async function ready() {
  show();
  await screen.findByRole('option', { name: CALLS.title });
  await screen.findByRole('checkbox', { name: /Tara Okafor/ });
}

/** The list entry with this heading. */
async function entryOf(title: string) {
  const heading = await screen.findByRole('heading', { level: 3, name: title });
  const item = heading.closest('li');
  if (!item) throw new Error(`No entry for ${title}`);
  return within(item);
}

// The kit's checkboxes measure themselves inside a form, and jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe = () => undefined;
  unobserve = () => undefined;
  disconnect = () => undefined;
}

beforeAll(() => {
  window.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssignScreen', () => {
  it('assigns a course to people and groups, then lists it', async () => {
    const { sent } = serveAssign();
    await ready();
    expect(screen.getByRole('heading', { level: 1, name: 'Assign' })).toBeInTheDocument();
    expect(screen.getByText('Nothing is assigned yet.')).toBeInTheDocument();
    // Guests can't take courses yet, so they aren't offered.
    expect(screen.queryByRole('checkbox', { name: /Gwen Ito/ })).not.toBeInTheDocument();

    choose(`course:${CALLS.id}`);
    fireEvent.click(screen.getByRole('checkbox', { name: /Tara Okafor/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Front desk/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Due date' }), {
      target: { value: 'date' },
    });
    fireEvent.change(screen.getByLabelText(/^Due on/), { target: { value: '2030-11-20' } });
    fireEvent.click(assignButton());

    const said = await screen.findByText(
      'Assigned "Handling calls with care" to 1 person and 1 group.',
    );
    expect(said).toHaveAttribute('role', 'status');
    expect(sent).toEqual([
      {
        target: { type: 'course', id: CALLS.id },
        people: [TARA],
        groups: [FRONT_DESK],
        dueDate: '2030-11-20',
        required: true,
      },
    ]);
    const entry = await entryOf(CALLS.title);
    expect(entry.getByText('For Tara Okafor and Front desk (group)')).toBeInTheDocument();
    expect(entry.getByText(`Due ${formatDueDate('2030-11-20')} · Required`)).toBeInTheDocument();
    expect(
      entry.getByText(
        `Assigned by Dana Reyes on ${formatDay('2026-10-27T15:00:00.000Z', LEARNING_DAY_ZONE)}`,
      ),
    ).toBeInTheDocument();
    // The form starts again, empty.
    expect(target()).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /Tara Okafor/ })).not.toBeChecked();
  });

  it('finds people by name or email', async () => {
    serveAssign();
    await ready();
    const search = screen.getByRole('searchbox', { name: 'Find people' });

    fireEvent.change(search, { target: { value: 'OMAR@' } });
    expect(screen.getByRole('checkbox', { name: /Omar Haddad/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Tara Okafor/ })).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'nobody' } });
    expect(
      screen.getByText('No one matches. Check the spelling, or search by email.'),
    ).toBeInTheDocument();
  });

  it('says what to fix, and takes the focus to the first thing to fix', async () => {
    const { world, sent } = serveAssign();
    await ready();

    fireEvent.click(assignButton());
    expect(await screen.findByText('Choose a course or path.')).toBeInTheDocument();
    expect(screen.getByText('Choose at least one person or group.')).toBeInTheDocument();
    expect(target()).toHaveFocus();
    expect(target()).toHaveAttribute('aria-invalid', 'true');

    choose(`course:${CALLS.id}`);
    fireEvent.click(assignButton());
    await waitFor(() =>
      expect(screen.getByRole('searchbox', { name: 'Find people' })).toHaveFocus(),
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /Tara Okafor/ }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Due date' }), {
      target: { value: 'days' },
    });
    const days = screen.getByRole('spinbutton', { name: 'Days to finish' });
    fireEvent.change(days, { target: { value: '5000' } });
    fireEvent.click(assignButton());
    expect(
      await screen.findByText('Enter a whole number of days from 1 to 3650.'),
    ).toBeInTheDocument();
    expect(days).toHaveFocus();
    expect(sent).toEqual([]);

    // The server's messages go to their fields; the rest show above the form.
    world.issues = [
      { path: 'people[0]', message: 'Choose people from the workspace.' },
      { path: 'target', message: 'This course is no longer published.' },
      { path: '', message: 'Assign fewer people at once.' },
    ];
    fireEvent.change(days, { target: { value: '14' } });
    fireEvent.click(assignButton());
    expect(await screen.findByText('Choose people from the workspace.')).toBeInTheDocument();
    expect(screen.getByText('This course is no longer published.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Assign fewer people at once.');
    expect(target()).toHaveFocus();
    expect(sent).toHaveLength(1);
  });

  it('removes an assignment after asking, and moves the focus to the list', async () => {
    const { removed } = serveAssign({ assignments: [assignment({ dueInDays: 14 })] });
    show();
    const entry = await entryOf(CALLS.title);
    expect(entry.getByText('For Tara Okafor')).toBeInTheDocument();
    expect(entry.getByText("Due 14 days after it's assigned · Required")).toBeInTheDocument();
    expect(
      entry.getByText(`Assigned by Dana Reyes on ${formatDay(MADE_AT, LEARNING_DAY_ZONE)}`),
    ).toBeInTheDocument();
    const remove = entry.getByRole('button', { name: `Remove ${CALLS.title} for Tara Okafor` });

    fireEvent.click(remove);
    let dialog = await screen.findByRole('dialog', { name: 'Remove this assignment?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(removed).toEqual([]);
    await waitFor(() => expect(remove).toHaveFocus());

    fireEvent.click(remove);
    dialog = await screen.findByRole('dialog', { name: 'Remove this assignment?' });
    expect(dialog).toHaveTextContent(
      `"${CALLS.title}" will no longer be assigned to Tara Okafor. What they've done so far stays.`,
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText(`Removed "${CALLS.title}".`)).toBeInTheDocument();
    expect(removed).toEqual(['10000000-0000-4000-8000-000000000001']);
    expect(await screen.findByText('Nothing is assigned yet.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: 'Assignments' })).toHaveFocus(),
    );
  });

  it('offers the courses not in the catalog and the paths to people who build them', async () => {
    const { sent } = serveAssign({
      studio: [
        { ...PRIVACY, state: 'live', archived: false, listed: false },
        {
          id: 'course-draft',
          title: 'Night shift handover',
          state: 'draft',
          archived: false,
          listed: false,
        },
      ],
      paths: [
        {
          id: 'path-new-starters',
          title: 'New starters',
          courseCount: 2,
          order: 'sequential',
          updatedAt: MADE_AT,
        },
      ],
    });
    await ready();
    expect(
      screen.getByRole('option', { name: 'Privacy basics (not in the catalog)' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Night shift handover/ })).not.toBeInTheDocument();

    choose('path:path-new-starters');
    fireEvent.click(screen.getByRole('checkbox', { name: /Front desk/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Required' }));
    fireEvent.click(assignButton());

    expect(await screen.findByText('Assigned "New starters" to 1 group.')).toBeInTheDocument();
    expect(sent).toEqual([
      {
        target: { type: 'path', id: 'path-new-starters' },
        people: [],
        groups: [FRONT_DESK],
        required: false,
      },
    ]);
    const entry = await entryOf('New starters');
    expect(
      entry.getByText(`Learning path: ${CALLS.title} and ${PRIVACY.title}`),
    ).toBeInTheDocument();
    expect(entry.getByText('No due date · Optional')).toBeInTheDocument();
  });

  it('counts people and groups when core cannot list them yet', async () => {
    serveAssign({ members: 404, groups: 404, assignments: [assignment({ groups: [FRONT_DESK] })] });
    show();
    const entry = await entryOf(CALLS.title);
    expect(entry.getByText('For 1 person and 1 group')).toBeInTheDocument();
    expect(
      entry.getByText(
        `Assigned by someone in this workspace on ${formatDay(MADE_AT, LEARNING_DAY_ZONE)}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Care Hub can't list the people here yet.")).toBeInTheDocument();
    expect(screen.getByText("Care Hub can't list the groups here yet.")).toBeInTheDocument();
  });

  it('says what went wrong and loads again on Retry', async () => {
    const { world } = serveAssign({ list: 404 });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This was deleted, or the link is wrong.',
    );
    expect(screen.queryByRole('combobox', { name: 'Course or path' })).not.toBeInTheDocument();
    world.list = 200;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Nothing is assigned yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });

  it('tells people who may not assign, without the form', async () => {
    serveAssign({ list: 403 });
    show();
    expect(await screen.findByRole('alert')).toHaveTextContent("You don't have access to this.");
    expect(screen.getByRole('heading', { level: 1, name: 'Assign' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Course or path' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
