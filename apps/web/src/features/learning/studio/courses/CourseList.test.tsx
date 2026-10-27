import { checkPublishable, sampleCourses } from '@carehub/learning';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StudioError } from '../data/client';
import type { StudioClient } from '../data/client';
import { StudioScreen } from '../index';
import { pageTitles, renderStudio, testStudioClient } from '../test-utils';

// Fictional data only.
const publishable = sampleCourses.find((course) => checkPublishable(course).length === 0);

/** One published course, one draft and one archived course. */
async function someCourses(): Promise<StudioClient> {
  if (!publishable) throw new Error('Expected a sample course ready to publish');
  const client = testStudioClient();
  const live = await client.createCourse({
    type: publishable.type,
    exampleId: publishable.id,
    title: 'Fire safety',
  });
  await client.publish(live.course.id, { notify: 'none' });
  await client.createCourse({ type: 'standard', title: 'Hand hygiene basics' });
  const old = await client.createCourse({ type: 'microlearning', title: 'Old induction' });
  await client.archive(old.course.id);
  return client;
}

const courseLinks = () => screen.getAllByRole('link').map((link) => link.textContent);
/** Waits until a course editor's address is open. */
const editorOpened = () =>
  waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/learning\/studio\/courses\/[^/]+$/,
    ),
  );

describe('Studio course list', () => {
  it('is one screen with its title, and says how to start when there are no courses', async () => {
    renderStudio('/learning/studio');
    expect(
      await screen.findByText('No courses yet. Start one with New course.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Studio');
    expect(pageTitles()).toContain('Care Hub · Studio');
  });

  it('starts a course from a type and a title, and opens it in the editor', async () => {
    const { client } = renderStudio('/learning/studio');
    const button = screen.getByRole('button', { name: 'New course' });
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'New course' });
    const standard = within(dialog).getByRole('radio', { name: 'Standard' });
    expect(standard).toBeChecked();
    expect(standard).toHaveAccessibleDescription(/^Lessons in any order/);
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Certification' }));
    expect(within(dialog).getByRole('radio', { name: 'Certification' })).toBeChecked();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
      target: { value: '  Safe lifting  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create course' }));

    await editorOpened();
    const [course] = await client.listCourses();
    expect(course).toMatchObject({ title: 'Safe lifting', type: 'certification', state: 'draft' });
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/learning/studio/courses/${course?.id}`,
    );
  });

  it('names a course "Untitled course" when no title is given, and Cancel closes', async () => {
    const { client } = renderStudio('/learning/studio');
    fireEvent.click(screen.getByRole('button', { name: 'New course' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await client.listCourses()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'New course' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create course' }));
    await editorOpened();
    expect(await client.listCourses()).toMatchObject([
      { title: 'Untitled course', type: 'standard' },
    ]);
  });

  it('copies an example course to start from', async () => {
    const { client } = renderStudio('/learning/studio');
    fireEvent.click(screen.getByRole('button', { name: 'New course' }));
    const [example] = await client.listExamples();
    if (!example) throw new Error('Expected example courses');
    fireEvent.click(await screen.findByRole('button', { name: `Copy ${example.title}` }));

    await editorOpened();
    expect((await client.listCourses()).map((course) => course.title)).toEqual([example.title]);
  });

  it('finds courses by the words in their title and by where they stand', async () => {
    renderStudio('/learning/studio', { client: await someCourses() });
    const live = await screen.findByRole('link', { name: 'Fire safety' });
    expect(live.getAttribute('href')).toMatch(/^\/learning\/studio\/courses\/id-/);
    expect(live.closest('li')).toHaveTextContent('Live, version 1');
    expect(
      screen.getByRole('link', { name: 'Hand hygiene basics' }).closest('li'),
    ).toHaveTextContent('Standard · Draft');
    expect(screen.queryByRole('link', { name: 'Old induction' })).toBeNull();

    const search = screen.getByRole('searchbox', { name: 'Search courses' });
    fireEvent.change(search, { target: { value: 'HYGIENE hand' } });
    expect(courseLinks()).toEqual(['Hand hygiene basics']);
    fireEvent.change(search, { target: { value: 'tax' } });
    expect(screen.getByText('No courses match “tax”.')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
    expect(screen.getByRole('button', { name: 'Drafts' })).toHaveAttribute('aria-pressed', 'true');
    expect(courseLinks()).toEqual(['Hand hygiene basics']);
    fireEvent.click(screen.getByRole('button', { name: 'Published' }));
    expect(courseLinks()).toEqual(['Fire safety']);
    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    expect(await screen.findByRole('link', { name: 'Old induction' })).toBeInTheDocument();
    expect(courseLinks()).toEqual(['Old induction']);
  });

  it('duplicates, archives and brings back a course', async () => {
    const client = testStudioClient();
    await client.createCourse({ type: 'standard', title: 'Hand hygiene basics' });
    renderStudio('/learning/studio', { client });
    const said = (text: string) =>
      waitFor(() => expect(screen.getByText(text)).toBeInTheDocument());

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate Hand hygiene basics' }));
    await said('Copied “Hand hygiene basics”. The copy is a draft.');
    expect(
      await screen.findByRole('link', { name: 'Copy of Hand hygiene basics' }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive Hand hygiene basics' }));
    await said('Archived “Hand hygiene basics”. Find it under Archived.');
    await waitFor(() => expect(courseLinks()).toEqual(['Copy of Hand hygiene basics']));

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Unarchive Hand hygiene basics' }));
    await said('“Hand hygiene basics” is back with your courses.');
    expect(await screen.findByText('No archived courses.')).toBeInTheDocument();
    expect((await client.listCourses()).map((course) => course.title).sort()).toEqual([
      'Copy of Hand hygiene basics',
      'Hand hygiene basics',
    ]);
  });

  it('says what went wrong and tries again', async () => {
    const client = testStudioClient();
    await client.createCourse({ type: 'standard', title: 'Hand hygiene basics' });
    let offline = true;
    const flaky: StudioClient = {
      ...client,
      listCourses: async (options) => {
        if (offline) throw new StudioError('offline', 'No answer from the server');
        return client.listCourses(options);
      },
    };
    renderStudio('/learning/studio', { client: flaky });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're offline. Check your connection and try again.",
    );
    offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'Hand hygiene basics' })).toBeInTheDocument();
  });

  it('tells people who may not build courses that Studio is not for them', () => {
    renderStudio('/learning/studio', { canBuild: false });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("You don't have access");
    expect(screen.queryByRole('button', { name: 'New course' })).toBeNull();
  });

  it('renders on its own, as the app routes do', () => {
    render(<StudioScreen />);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Studio');
  });
});
