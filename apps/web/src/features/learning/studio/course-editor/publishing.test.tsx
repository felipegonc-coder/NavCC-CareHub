import { checkPublishable, sampleCourses } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StudioClient } from '../data/client';
import { renderEditor, renderStudio, testStudioClient } from '../test-utils';

// Fictional data only.
const publishable = sampleCourses.find((course) => checkPublishable(course).length === 0);

const unfinished = (blank: Course): Course => ({
  ...blank,
  settings: {
    ...blank.settings,
    completion: { ...blank.settings.completion, requireAcknowledgement: true },
  },
  lessons: [
    {
      id: 'lesson-why',
      kind: 'content',
      title: 'Why it matters',
      blocks: [{ id: 'block-1', type: 'paragraph', text: [] }],
    },
    { id: 'lesson-moments', kind: 'content', title: 'Five moments', blocks: [] },
  ],
});

/** A copy of a sample course that is ready to publish. */
async function readyCourse() {
  if (!publishable) throw new Error('Expected a sample course ready to publish');
  const client = testStudioClient();
  const draft = await client.createCourse({ type: publishable.type, exampleId: publishable.id });
  return { client, courseId: draft.course.id, title: draft.course.title };
}

async function open(client: StudioClient, courseId: string) {
  renderStudio(`/learning/studio/courses/${courseId}`, { client });
  const { course } = await client.getCourse(courseId);
  await screen.findByRole('heading', { level: 1, name: course.title });
}

const panel = (name: string) => screen.getByRole('region', { name });
const showMe = (message: string) =>
  fireEvent.click(screen.getByRole('button', { name: `Show me: ${message}` }));

/** GET /api/auth/me says the person's profile is in `timeZone`. Other requests get a 404. */
function withProfileZone(timeZone: string) {
  const me = JSON.stringify({ user: { id: 'user-kai', name: 'Kai Example', timeZone } });
  vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
    Promise.resolve(
      input === '/api/auth/me'
        ? new Response(me, { headers: { 'Content-Type': 'application/json' } })
        : new Response(null, { status: 404 }),
    ),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('publishing from the course editor', () => {
  it('lists what to fix in plain words, each with a way to the place', async () => {
    await renderEditor(unfinished);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const publish = panel('Before publishing');
    expect(within(publish).getByText('Fix these 3 things before publishing:')).toBeInTheDocument();

    showMe('Lesson 2 "Five moments" has no blocks.');
    expect(screen.getByRole('link', { name: '2. Five moments' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    showMe('Lesson 1 "Why it matters": block 1 (paragraph) needs text.');
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Block 1, Paragraph' })).toHaveFocus(),
    );

    showMe('The course asks for an acknowledgement but has no statement to acknowledge.');
    await waitFor(() => expect(panel('Course settings')).toHaveFocus());
    fireEvent.change(screen.getByRole('textbox', { name: 'Acknowledgement statement' }), {
      target: { value: 'I have read and understood this.' },
    });
    expect(within(publish).getByText('Fix these 2 things before publishing:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('publishes, then publishes again moving people partway through', async () => {
    const { client, courseId } = await readyCourse();
    await open(client, courseId);
    expect(screen.getByText('Draft, not published yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    let dialog = screen.getByRole('dialog', { name: 'Publish this course' });
    expect(within(dialog).queryByRole('group', { name: 'People who already started' })).toBeNull();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'What changed' }), {
      target: { value: 'First version' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/^Published version 1\./)).toBeInTheDocument();
    expect(screen.getByText('Live, version 1')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Course title' }), {
      target: { value: 'Hand hygiene, updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    dialog = screen.getByRole('dialog', { name: 'Publish version 2' });
    const started = within(dialog).getByRole('group', { name: 'People who already started' });
    expect(within(started).getByRole('radio', { name: "Don't tell them" })).toBeChecked();
    const tell = within(started).getByRole('radio', {
      name: 'Move them to this version and tell them',
    });
    expect(tell).toHaveAccessibleDescription(/^People partway through carry on in this version/);
    fireEvent.click(tell);
    expect(tell).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish version 2' }));
    expect(await screen.findByText(/^Published version 2\./)).toBeInTheDocument();

    const versions = await client.listVersions(courseId);
    expect(versions.map(({ version, note }) => [version, note ?? null])).toEqual([
      [2, null],
      [1, 'First version'],
    ]);
    expect(versions[0]?.title).toBe('Hand hygiene, updated');
  });

  it('rolls back to an earlier version after asking', async () => {
    const { client, courseId, title } = await readyCourse();
    await client.publish(courseId, { notify: 'none' });
    const draft = await client.getCourse(courseId);
    await client.saveCourse(
      courseId,
      { ...draft.course, title: 'Hand hygiene, version 2' },
      draft.revision,
    );
    await client.publish(courseId, { notify: 'none' });
    await open(client, courseId);
    expect(screen.getByText('Live, version 2')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Versions' }));
    const versions = panel('Versions');
    expect(await within(versions).findByText('Version 2')).toBeInTheDocument();
    expect(within(versions).queryByRole('button', { name: 'Roll back to version 2' })).toBeNull();
    fireEvent.click(within(versions).getByRole('button', { name: 'Roll back to version 1' }));
    expect(within(versions).getByText(/^Publish version 1 again\?/)).toBeInTheDocument();
    fireEvent.click(within(versions).getByRole('button', { name: 'Roll back' }));

    expect(await screen.findByRole('heading', { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByText('Live, version 3')).toBeInTheDocument();
    expect(
      screen.getByText('Rolled back: version 3 is live and is your draft now.'),
    ).toBeInTheDocument();
    expect((await client.listVersions(courseId))[0]).toMatchObject({ version: 3, title });

    fireEvent.change(screen.getByRole('textbox', { name: 'Course title' }), {
      target: { value: 'Hand hygiene, after the roll back' },
    });
    await waitFor(
      async () =>
        expect((await client.getCourse(courseId)).course.title).toBe(
          'Hand hygiene, after the roll back',
        ),
      { timeout: 3000 },
    );
  });

  it("shows when each version was published in the person's time zone", async () => {
    withProfileZone('Pacific/Honolulu');
    const { client, courseId, title } = await readyCourse();
    await client.publish(courseId, { notify: 'none' });
    const [published] = await client.listVersions(courseId);
    if (!published) throw new Error('Expected version 1');
    // The same moment is another day and hour in Denver, the zone used until the profile loads.
    const when = (timeZone: string) =>
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone })
        .format(new Date(published.publishedAt))
        .replace(/\s+/g, ' ');
    expect(when('Pacific/Honolulu')).not.toBe(when('America/Denver'));

    await open(client, courseId);
    fireEvent.click(screen.getByRole('button', { name: 'Versions' }));
    expect(
      await within(panel('Versions')).findByText(`${when('Pacific/Honolulu')} · ${title}`),
    ).toBeInTheDocument();
  });
});
