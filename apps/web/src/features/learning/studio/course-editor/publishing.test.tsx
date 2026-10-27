import { checkPublishable, sampleCourses } from '@carehub/learning';
import type { Course } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

describe('publishing from the course editor', () => {
  it('lists what to fix in plain words, each with a way to the place', async () => {
    await renderEditor(unfinished);
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    const publish = panel('Publish');
    expect(within(publish).getByText('Fix these 3 things before publishing:')).toBeInTheDocument();

    showMe('Lesson 2 "Five moments" has no blocks.');
    expect(screen.getByRole('button', { name: '2. Five moments' })).toHaveAttribute(
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
  });

  it('publishes, then publishes again telling people who finished', async () => {
    const { client, courseId } = await readyCourse();
    await open(client, courseId);
    expect(screen.getByText('Draft, not published yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    expect(screen.queryByRole('group', { name: 'People who already started' })).toBeNull();
    fireEvent.change(within(panel('Publish')).getByRole('textbox', { name: 'What changed' }), {
      target: { value: 'First version' },
    });
    fireEvent.click(within(panel('Publish')).getByRole('button', { name: 'Publish' }));
    expect(await screen.findByText(/^Published version 1\./)).toBeInTheDocument();
    expect(screen.getByText('Live, version 1')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Publish' })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Course title' }), {
      target: { value: 'Hand hygiene, updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to this one' }));
    expect(screen.getByText(/^People partway through move to this version/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Publish version 2' }));
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
});
