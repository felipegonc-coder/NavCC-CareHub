import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RowTemplate } from '@carehub/databases';
import { ApiError, type DatabaseWithVersion } from '../api';
import {
  JOBS_ID,
  jobsDatabase,
  jobsViews,
  mockClient,
  renderWithDatabase,
  testViewer,
  VIEWS,
} from '../test-utils';
import { DatabaseView } from './database-view';

vi.mock('../layouts', async () => {
  const { probeLayouts } = await import('./test-layout');
  return { LAYOUTS: probeLayouts() };
});

const viewer = testViewer();
const visit: RowTemplate = { id: 'template-visit', name: 'Site visit', icon: '🔧', values: {} };
const quote: RowTemplate = { id: 'template-quote', name: 'Quote', icon: null, values: {} };

/** Jobs with two templates, Quote being the database's default; settings writes answer the same. */
function withTemplates(overrides: Partial<DatabaseWithVersion> = {}) {
  const client = mockClient();
  const meta = jobsDatabase({
    templates: [visit, quote],
    defaultTemplateId: quote.id,
    ...overrides,
  });
  client.getDatabase.mockResolvedValue(meta);
  client.updateDatabase.mockResolvedValue(meta);
  client.updateView.mockResolvedValue(meta);
  return client;
}

const onOpenRow = vi.fn();

async function shown(client = withTemplates()) {
  renderWithDatabase(<DatabaseView databaseId={JOBS_ID} viewer={viewer} onOpenRow={onOpenRow} />, {
    client,
  });
  await screen.findByTestId('probe-layout');
  return client;
}

async function openTemplates() {
  fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
  return screen.findByRole('dialog', { name: 'Templates' });
}

/** Opens a template's "…" from the keyboard, as Radix menus open on Enter. */
async function templateMenu(name: string) {
  const popover = await openTemplates();
  const button = await within(popover).findByRole('button', { name: `More actions for ${name}` });
  fireEvent.keyDown(button, { key: 'Enter' });
  return screen.findByRole('menu');
}

beforeEach(() => {
  localStorage.clear();
  onOpenRow.mockClear();
});

describe('New ▾', () => {
  it('makes a row with the default template and opens it', async () => {
    const client = await shown();
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await waitFor(() =>
      expect(client.createRow).toHaveBeenCalledWith(
        JOBS_ID,
        expect.objectContaining({ templateId: quote.id, viewId: VIEWS.table }),
      ),
    );
    await waitFor(() => expect(onOpenRow).toHaveBeenCalledWith('row-new', 'side_peek'));
  });

  it('lists the templates in order with the default marked, then Empty and + New template', async () => {
    await shown();
    const list = within(await openTemplates()).getByRole('list', { name: 'Templates' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['🔧Site visit', 'Quote Default', 'Empty']);
    expect(screen.getByRole('button', { name: '+ New template' })).toBeInTheDocument();
  });

  it('marks Empty as the default when the view makes empty rows', async () => {
    const views = jobsViews().map((v) =>
      v.id === VIEWS.table ? { ...v, defaultTemplateId: null } : v,
    );
    await shown(withTemplates({ views }));
    const list = within(await openTemplates()).getByRole('list', { name: 'Templates' });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['🔧Site visit', 'Quote', 'Empty Default']);
  });

  it('makes a row from the template picked, or an empty one', async () => {
    const client = await shown();
    fireEvent.click(within(await openTemplates()).getByRole('button', { name: 'Site visit' }));
    await waitFor(() =>
      expect(client.createRow).toHaveBeenCalledWith(
        JOBS_ID,
        expect.objectContaining({ templateId: visit.id }),
      ),
    );
    expect(screen.queryByRole('dialog', { name: 'Templates' })).toBeNull();

    fireEvent.click(within(await openTemplates()).getByRole('button', { name: 'Empty' }));
    await waitFor(() => expect(client.createRow).toHaveBeenCalledTimes(2));
    expect(client.createRow.mock.calls[1]?.[1]).toMatchObject({ templateId: undefined });
  });

  it('opens a new template to edit it', async () => {
    const client = await shown();
    fireEvent.click(within(await openTemplates()).getByRole('button', { name: '+ New template' }));
    await waitFor(() => expect(client.createTemplate).toHaveBeenCalledWith(JOBS_ID, {}));
    await waitFor(() => expect(onOpenRow).toHaveBeenCalledWith('template-new', 'side_peek'));
  });

  it('gives each template\'s "…" to people who can change the structure', async () => {
    const client = await shown();
    const menu = await templateMenu('Site visit');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Edit', 'Set as default for this view', 'Set as default for all views', 'Delete']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit' }));
    expect(onOpenRow).toHaveBeenCalledWith(visit.id, 'side_peek');
    expect(client.createRow).not.toHaveBeenCalled();
  });

  it('sets the default for this view, or for every view', async () => {
    const views = jobsViews().map((v) =>
      v.id === VIEWS.board ? { ...v, defaultTemplateId: null } : v,
    );
    const client = await shown(withTemplates({ views }));
    fireEvent.click(
      within(await templateMenu('Site visit')).getByRole('menuitem', {
        name: 'Set as default for this view',
      }),
    );
    await waitFor(() =>
      expect(client.updateView).toHaveBeenCalledWith(JOBS_ID, VIEWS.table, {
        defaultTemplateId: visit.id,
      }),
    );

    client.updateView.mockClear();
    fireEvent.click(
      within(await templateMenu('Site visit')).getByRole('menuitem', {
        name: 'Set as default for all views',
      }),
    );
    await waitFor(() =>
      expect(client.updateDatabase).toHaveBeenCalledWith(JOBS_ID, { defaultTemplateId: visit.id }),
    );
    // The board had a default of its own; All jobs uses the database's.
    await waitFor(() =>
      expect(client.updateView).toHaveBeenCalledWith(JOBS_ID, VIEWS.board, {
        defaultTemplateId: visit.id,
      }),
    );
    expect(client.updateView).toHaveBeenCalledTimes(1);
  });

  it('deletes a template, and says why when it is refused', async () => {
    const client = await shown();
    client.deleteTemplate.mockRejectedValueOnce(
      new ApiError(403, 'forbidden', "You don't have access to this."),
    );
    fireEvent.click(within(await templateMenu('Quote')).getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(client.deleteTemplate).toHaveBeenCalledWith(JOBS_ID, quote.id));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent("You don't have access to this."),
    );
  });

  it('leaves out "…" and + New template for Can edit content', async () => {
    await shown(withTemplates({ viewerAccess: 'edit_content' }));
    const popover = await openTemplates();
    expect(within(popover).queryByRole('button', { name: /^More actions/ })).toBeNull();
    expect(within(popover).queryByRole('button', { name: '+ New template' })).toBeNull();
  });

  it("has no arrow when there are no templates and the person can't make them", async () => {
    const client = mockClient();
    client.getDatabase.mockResolvedValue(jobsDatabase({ viewerAccess: 'edit_content' }));
    await shown(client);
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Templates' })).toBeNull();
  });
});
