import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { GalleryScreen } from './gallery';
import { galleryUrl } from './links';
import { fakeClient, LAUNCH_ID, PAGE_ID, renderAt } from './test-utils';

const findCard = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}`) });
const queryCard = (name: string) => screen.queryByRole('button', { name: new RegExp(`^${name}`) });

describe('the template gallery', () => {
  it('has the search box focused and searches names, descriptions and categories', async () => {
    renderAt(<GalleryScreen />);
    const search = screen.getByRole('searchbox', { name: 'Search templates' });
    expect(search).toHaveFocus();
    expect(await findCard('Meeting notes')).toBeInTheDocument();
    expect(screen.getByText('by Sam Ortiz')).toBeInTheDocument();
    expect(screen.getAllByText('by Care Hub')).toHaveLength(3);

    fireEvent.change(search, { target: { value: 'meeting' } });
    expect(screen.getByRole('heading', { name: 'Results for “meeting”' })).toBeInTheDocument();
    expect(await findCard('Meeting notes')).toBeInTheDocument();
    expect(await findCard('Weekly huddle')).toBeInTheDocument(); // its category is Meetings
    expect(queryCard('Launch plan')).toBeNull();

    fireEvent.change(search, { target: { value: 'zebra crossing' } });
    expect(screen.getByText('No templates match your search.')).toBeInTheDocument();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
  });

  it('lists the categories that have templates, Made in this workspace first', async () => {
    renderAt(<GalleryScreen />);
    const nav = await screen.findByRole('navigation', { name: 'Categories' });
    const names = within(nav)
      .getAllByRole('button')
      .map((button: HTMLElement) => button.textContent);
    expect(names).toEqual([
      'All templates',
      'Made in this workspace',
      'Meetings',
      'Projects',
      'Support',
    ]);
    fireEvent.click(within(nav).getByRole('button', { name: 'Support' }));
    expect(within(nav).getByRole('button', { name: 'Support' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
    expect(await findCard('Incident review')).toBeInTheDocument();
    expect(queryCard('Meeting notes')).toBeNull();
  });

  it('moves between cards with the arrow keys and opens the preview with Enter', async () => {
    renderAt(<GalleryScreen />);
    const search = screen.getByRole('searchbox', { name: 'Search templates' });
    const launch = await findCard('Launch plan');
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    expect(launch).toHaveFocus();
    fireEvent.keyDown(launch, { key: 'ArrowRight' });
    expect(await findCard('Meeting notes')).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(await findCard('Incident review')).toHaveFocus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(search).toHaveFocus();

    fireEvent.keyDown(search, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Launch plan' });
    expect(
      within(dialog).getByText('by Sam Ortiz · 1 sub-page, 1 database with 6 sample rows'),
    ).toBeInTheDocument();
    expect(await within(dialog).findByRole('heading', { name: 'Goals' })).toBeInTheDocument();
    const contents = within(dialog).getByRole('region', { name: 'What comes with it' });
    expect(within(contents).getByText('Agenda')).toBeInTheDocument();
    expect(within(contents).getByText('(database)')).toBeInTheDocument();
    expect(within(dialog).getByRole('switch', { name: 'Include sample rows' })).toBeChecked();
  });

  it('uses the template where the gallery was opened from, then opens the copy', async () => {
    const client = fakeClient();
    renderAt(<GalleryScreen />, {
      client,
      url: galleryUrl({ pageId: PAGE_ID, mode: 'apply' }),
      state: { title: 'Q4 kickoff' },
    });
    fireEvent.click(await findCard('Weekly huddle'));
    const dialog = await screen.findByRole('dialog', { name: 'Weekly huddle' });
    expect(within(dialog).getByRole('combobox', { name: 'Add to:' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('switch')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use template' }));
    expect(await screen.findByText('The new page')).toBeInTheDocument();
    expect(client.copy).toHaveBeenCalledWith('weekly-huddle', {
      target: { type: 'apply', pageId: PAGE_ID },
      includeSampleRows: true,
    });
  });

  it('uses a template at once with Ctrl+Enter, in Private from the sidebar', async () => {
    const client = fakeClient();
    renderAt(<GalleryScreen />, { client });
    const huddle = await findCard('Weekly huddle');
    huddle.focus();
    fireEvent.keyDown(huddle, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByText('The new page')).toBeInTheDocument();
    expect(client.copy).toHaveBeenCalledWith('weekly-huddle', {
      target: { type: 'private' },
      includeSampleRows: true,
    });
  });

  it('says in the preview why Use template failed', async () => {
    const refused = new ApiError(403, 'forbidden', "You don't have access to this.");
    const client = fakeClient({ copy: vi.fn(async () => Promise.reject(refused)) });
    renderAt(<GalleryScreen />, { client });
    fireEvent.click(await findCard('Launch plan'));
    const dialog = await screen.findByRole('dialog', { name: 'Launch plan' });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Include sample rows' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use template' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      "You don't have access to this.",
    );
    expect(client.copy).toHaveBeenCalledWith(LAUNCH_ID, {
      target: { type: 'private' },
      includeSampleRows: false,
    });
  });

  it('offers Try again when the gallery can’t load', async () => {
    const offline = new ApiError(0, 'offline', "Can't reach Care Hub. Check your connection.");
    const gallery = vi.fn(async () => Promise.reject(offline));
    renderAt(<GalleryScreen />, { client: fakeClient({ gallery }) });
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Care Hub.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(gallery).toHaveBeenCalledTimes(2));
  });
});
