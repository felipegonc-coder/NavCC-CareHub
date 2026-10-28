import { sampleLearningPath, type LearningPath } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageTitles } from '../test-utils';
import { renderPaths, servePaths } from './test-utils';

// The sample new-starter path: a live course, one with unpublished changes and a draft (Fictional
// data only).
const EDITOR = '/learning/studio/paths/path-new-starter';

const region = (name: string) => within(screen.getByRole('region', { name }));
const pathCourses = () =>
  region('Courses')
    .getAllByRole('listitem')
    .map((item) => item.textContent);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const status = () => screen.getByRole('status');

/** Opens the builder on `path` and waits for the Studio courses (it checks the path then). */
async function openBuilder(path: LearningPath = sampleLearningPath) {
  const api = servePaths([path]);
  renderPaths(EDITOR);
  await screen.findByRole('region', { name: 'Ready to assign' });
  return api;
}

afterEach(() => vi.restoreAllMocks());

describe('Path builder', () => {
  it("shows the path, each course's state, and what keeps it from being assigned", async () => {
    await openBuilder({
      ...sampleLearningPath,
      courseIds: [...sampleLearningPath.courseIds, 'course-old-induction', 'course-gone'],
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New starter path');
    expect(pageTitles()).toContain('Care Hub · New starter path');
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('New starter path');
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      'Your first two weeks at Brightside Support.',
    );
    expect(screen.getByRole('radio', { name: 'In order' })).toBeChecked();
    expect(pathCourses()).toEqual([
      '1Handling calls with careLive, version 2',
      '2Privacy basicsLive, version 1, with unpublished changes',
      '3Escalations certificationDraft',
      '4Old inductionArchived',
      '5Course 5Deleted',
    ]);
    expect(screen.getByRole('link', { name: 'Privacy basics' })).toHaveAttribute(
      'href',
      '/learning/studio/courses/course-privacy-basics',
    );
    expect(
      region('Ready to assign')
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      "“Escalations certification” isn't published yet. Publish it or remove it from the path.",
      '“Old induction” is archived. Unarchive it or remove it from the path.',
      'Course 5 was deleted. Remove it from the path.',
    ]);
    expect(status()).toHaveTextContent('All changes saved');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'View as learner' })).toHaveAttribute(
      'href',
      '/learning/paths/path-new-starter',
    );
    expect(screen.getByRole('link', { name: 'Learning paths' })).toHaveAttribute(
      'href',
      '/learning/studio/paths',
    );
  });

  it('reorders, removes and adds courses, then saves the whole path', async () => {
    const api = await openBuilder();
    click('Move Privacy basics up');
    expect(screen.getByText('Moved “Privacy basics” to number 1.')).toBeInTheDocument();
    click('Remove Escalations certification');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search courses' }), {
      target: { value: 'induction' },
    });
    expect(screen.getByText('No courses match “induction”.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search courses' }), {
      target: { value: 'FIRE' },
    });
    click('Add Fire safety');
    expect(pathCourses()).toEqual([
      '1Privacy basicsLive, version 1, with unpublished changes',
      '2Handling calls with careLive, version 2',
      '3Fire safetyLive, version 1',
    ]);
    expect(status()).toHaveTextContent('Unsaved changes');
    expect(api.sent('PUT')).toEqual([]);

    click('Save');
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    expect(api.sent('PUT')).toEqual([
      {
        method: 'PUT',
        url: '/api/learning/studio/paths/path-new-starter',
        body: {
          ...sampleLearningPath,
          courseIds: ['course-privacy-basics', 'course-calls-with-care', 'course-fire-safety'],
        },
      },
    ]);
    expect(region('Ready to assign').getByText('Ready to assign.')).toBeInTheDocument();
  });

  it("edits the title, description and order, and won't save without a title", async () => {
    const api = await openBuilder();
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: '   ' } });
    expect(screen.getByText('Give the path a title.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Untitled path');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.change(title, { target: { value: '  Team leads  ' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), {
      target: { value: '  ' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Any order' }));
    click('Save');
    await waitFor(() => expect(api.sent('PUT')).toHaveLength(1));
    const [saved] = api.sent('PUT');
    expect(saved?.body).toEqual({
      formatVersion: 1,
      id: 'path-new-starter',
      title: 'Team leads',
      courseIds: sampleLearningPath.courseIds,
      order: 'free',
    });
    expect(saved?.body).not.toHaveProperty('description');
    await waitFor(() => expect(pageTitles()).toContain('Care Hub · Team leads'));
  });

  it('says when saving fails, and keeps the changes', async () => {
    const api = await openBuilder();
    api.server.status = 500;
    click('Remove Privacy basics');
    click('Save');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "The path wasn't saved. Something went wrong on our side. Try again in a moment.",
    );
    expect(status()).toHaveTextContent('Unsaved changes');
    expect(pathCourses()).toHaveLength(2);
  });

  it('deletes the path after asking, then says so on the list', async () => {
    const api = await openBuilder();
    click('Delete');
    const dialog = screen.getByRole('dialog', { name: 'Delete “New starter path”?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.sent('DELETE')).toEqual([]);

    click('Delete');
    fireEvent.click(screen.getByRole('button', { name: 'Delete path' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/learning\/studio\/paths$/),
    );
    expect(api.sent('DELETE')).toHaveLength(1);
    expect(await screen.findByText('Deleted “New starter path”.')).toBeInTheDocument();
    expect(
      await screen.findByText('No learning paths yet. Start one with New path.'),
    ).toBeInTheDocument();
  });

  it('says when the path is not there', async () => {
    servePaths();
    renderPaths('/learning/studio/paths/path-gone');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Learning path not found' }),
    ).toBeInTheDocument();
    expect(screen.getByText('This path was deleted, or the link is wrong.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('says a bad link is not a path, without asking the server', () => {
    const api = servePaths([sampleLearningPath]);
    renderPaths('/learning/studio/paths/not%20a%20path');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Learning path not found');
    expect(api.calls).toEqual([]);
  });
});
