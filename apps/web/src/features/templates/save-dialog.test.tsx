import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api';
import { TemplatesOverlay } from './overlay';
import { SaveTemplateDialog } from './save-dialog';
import { openSaveAsTemplate, saveAllowed } from './save-store';
import { slots } from './slots';
import { audienceChoices, audienceFrom, audienceValue, categoryChoices } from './template-fields';
import { fakeClient, GALLERY, PAGE_ID, renderAt, SUPPORT_SPACE_ID } from './test-utils';

const page = { id: PAGE_ID, title: 'Q4 launch' };

describe('Save as template', () => {
  it('saves the page with its name, category, audience and sub-pages', async () => {
    const onClose = vi.fn();
    const { client } = renderAt(<SaveTemplateDialog page={page} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog', { name: 'Save as template' });
    expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Q4 launch');
    expect(within(dialog).getByRole('switch', { name: 'Include sub-pages' })).toBeChecked();
    expect(within(dialog).getByRole('combobox', { name: 'Who can use it' })).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/^Category/), {
      target: { value: 'Launches' },
    });
    fireEvent.change(within(dialog).getByLabelText('Description'), {
      target: { value: 'Goals, agenda and tickets.' },
    });
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Include sub-pages' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(client.save).toHaveBeenCalledWith({
      pageId: PAGE_ID,
      name: 'Q4 launch',
      description: 'Goals, agenda and tickets.',
      category: 'Launches',
      audience: { type: 'everyone' },
      includeSubpages: false,
    });
    expect(await screen.findByText('Saved Q4 launch as a template')).toBeInTheDocument();
  });

  it('asks for a name and a category before saving', async () => {
    const { client } = renderAt(<SaveTemplateDialog page={page} onClose={() => undefined} />);
    const dialog = await screen.findByRole('dialog', { name: 'Save as template' });
    fireEvent.change(within(dialog).getByLabelText(/^Name/), { target: { value: '  ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Give the template a name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Pick or type a category.')).toBeInTheDocument();
    expect(client.save).not.toHaveBeenCalled();
  });

  it('shows why the server refused', async () => {
    const client = fakeClient({
      save: vi.fn(async () => {
        throw new ApiError(413, 'too_big', 'Templates can hold up to 500 pages and 1 GB.');
      }),
    });
    renderAt(<SaveTemplateDialog page={page} onClose={() => undefined} />, { client });
    const dialog = await screen.findByRole('dialog', { name: 'Save as template' });
    fireEvent.change(within(dialog).getByLabelText(/^Category/), {
      target: { value: 'Projects' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Templates can hold up to 500 pages and 1 GB.',
    );
  });

  it('is in the page menu only for people who may save templates', async () => {
    const item = slots.pageMenuItems?.[0];
    const asPage = { id: PAGE_ID, kind: 'page' as const, title: 'Q4 launch' };
    expect(item?.label).toBe('Save as template');
    expect(saveAllowed()).toBe(false);
    expect(item?.isVisible?.(asPage)).toBe(false);

    renderAt(<TemplatesOverlay />);
    await waitFor(() => expect(item?.isVisible?.(asPage)).toBe(true));
    expect(item?.isVisible?.({ ...asPage, kind: 'row' })).toBe(false);

    act(() => openSaveAsTemplate(asPage));
    expect(await screen.findByRole('dialog', { name: 'Save as template' })).toBeInTheDocument();
  });

  it('hides the item when the gallery says no', async () => {
    const client = fakeClient({ gallery: vi.fn(async () => ({ ...GALLERY, canSave: false })) });
    renderAt(<TemplatesOverlay />, { client });
    await waitFor(() => expect(client.gallery).toHaveBeenCalled());
    await waitFor(() => expect(saveAllowed()).toBe(false));
  });
});

describe('the template form parts', () => {
  it('turns who can use it into a choice and back', () => {
    const support = { type: 'space' as const, spaceId: SUPPORT_SPACE_ID };
    expect(audienceFrom(audienceValue(support))).toEqual(support);
    expect(audienceFrom(audienceValue({ type: 'everyone' }))).toEqual({ type: 'everyone' });
    expect(audienceChoices(GALLERY.spaces).map((choice) => choice.label)).toEqual([
      'Everyone in the workspace',
      'Members of Support',
    ]);
    expect(audienceChoices([], { type: 'me' }).at(-1)?.label).toBe('Only me');
  });

  it('offers Care Hub’s categories, then the workspace’s own', () => {
    const choices = categoryChoices(['Made in this workspace', 'Meetings', 'Launches']);
    expect(choices).not.toContain('Made in this workspace');
    expect(choices.slice(0, 2)).toEqual(['Meetings', 'Projects']);
    expect(choices.at(-1)).toBe('Launches');
  });
});
