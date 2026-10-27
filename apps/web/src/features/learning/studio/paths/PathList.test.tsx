import { sampleLearningPath, type LearningPath } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pageTitles } from '../test-utils';
import { renderPaths, servePaths } from './test-utils';

// Fictional data only.
const onboarding: LearningPath = {
  formatVersion: 1,
  id: 'path-team-leads',
  title: 'Team lead onboarding',
  courseIds: ['course-fire-safety'],
  order: 'free',
};

const location = () => screen.getByTestId('location');

afterEach(() => vi.restoreAllMocks());

describe('Studio path list', () => {
  it('lists each path: courses, order, last change and a link to its builder', async () => {
    servePaths([sampleLearningPath, onboarding]);
    renderPaths('/learning/studio/paths');
    expect(await screen.findByRole('link', { name: 'New starter path' })).toHaveAttribute(
      'href',
      '/learning/studio/paths/path-new-starter',
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Learning paths');
    expect(pageTitles()).toContain('Care Hub · Learning paths');
    const [first, second, ...others] = screen.getAllByRole('listitem');
    expect(others).toEqual([]);
    expect(first).toHaveTextContent(/3 courses · In order · Edited \S/);
    expect(second).toHaveTextContent(/1 course · Any order · Edited \S/);
    expect(within(second as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/learning/studio/paths/path-team-leads',
    );
    expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute(
      'href',
      '/learning/studio',
    );
  });

  it('says how to start when there are no paths', async () => {
    servePaths();
    renderPaths('/learning/studio/paths');
    expect(
      await screen.findByText('No learning paths yet. Start one with New path.'),
    ).toBeInTheDocument();
  });

  it('starts a path with a title and opens it in the builder', async () => {
    const api = servePaths();
    renderPaths('/learning/studio/paths');
    fireEvent.click(screen.getByRole('button', { name: 'New path' }));
    const dialog = screen.getByRole('dialog', { name: 'New learning path' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), {
      target: { value: '  Team lead onboarding  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create path' }));

    await waitFor(() => expect(location()).toHaveTextContent('/learning/studio/paths/path-1'));
    expect(api.sent('POST')).toEqual([
      {
        method: 'POST',
        url: '/api/learning/studio/paths',
        body: { title: 'Team lead onboarding' },
      },
    ]);
    expect(api.store.get('path-1')).toMatchObject({ courseIds: [], order: 'sequential' });
  });

  it('names a path "Untitled path" when no title is given, and Cancel closes', async () => {
    const api = servePaths();
    renderPaths('/learning/studio/paths');
    fireEvent.click(screen.getByRole('button', { name: 'New path' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(api.sent('POST')).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'New path' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create path' }));
    await waitFor(() => expect(location()).toHaveTextContent('/learning/studio/paths/path-1'));
    expect(api.sent('POST')[0]?.body).toEqual({ title: 'Untitled path' });
  });

  it('keeps the dialog open and says why when the path is not created', async () => {
    const api = servePaths();
    renderPaths('/learning/studio/paths');
    await screen.findByText('No learning paths yet. Start one with New path.');
    api.server.status = 403;
    fireEvent.click(screen.getByRole('button', { name: 'New path' }));
    const dialog = screen.getByRole('dialog', { name: 'New learning path' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create path' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "The path wasn't created. You don't have access to learning paths. Ask an admin.",
    );
    expect(location()).toHaveTextContent(/^\/learning\/studio\/paths$/);
  });

  it('says when it is offline, and Retry loads the list once the connection is back', async () => {
    const api = servePaths([sampleLearningPath]);
    api.server.offline = true;
    renderPaths('/learning/studio/paths');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "You're offline. Check your connection and try again.",
    );
    api.server.offline = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('link', { name: 'New starter path' })).toBeInTheDocument();
  });

  it("tells people who can't build that Studio isn't for them, without asking the server", () => {
    const api = servePaths([sampleLearningPath]);
    renderPaths('/learning/studio/paths', { canBuild: false });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("You don't have access");
    expect(api.calls).toEqual([]);
  });
});
