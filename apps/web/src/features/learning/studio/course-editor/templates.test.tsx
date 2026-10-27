import type { Block, Course } from '@carehub/learning';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderEditor, testStudioClient } from '../test-utils';

const paragraph = (id: string, text: string): Block => ({
  id,
  type: 'paragraph',
  text: [{ runs: [{ text }] }],
});

/** A course whose one lesson, "Why it matters", has `blocks`. */
const withBlocks =
  (blocks: Block[]) =>
  (blank: Course): Course => ({
    ...blank,
    lessons: [{ id: 'lesson-why', kind: 'content', title: 'Why it matters', blocks }],
  });

const cards = () =>
  within(screen.getByRole('region', { name: 'Lesson: Why it matters' }))
    .getAllByRole('region')
    .map((card) => card.getAttribute('aria-label'))
    .filter((name) => name?.startsWith('Block '));

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
  return screen.getByRole('region', { name: 'Add a block' });
};

describe('Paste text', () => {
  it('turns pasted text into blocks, added as one undo step', async () => {
    await renderEditor(withBlocks([paragraph('block-1', 'Clean hands save lives.')]));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Paste text' }));
    const box = screen.getByRole('textbox', { name: 'Text to turn into blocks' });
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Add blocks' })).toBeDisabled();

    fireEvent.change(box, {
      target: { value: '# The five moments\n\n- Before touching a patient\n- Before a clean task' },
    });
    expect(screen.getByText('Makes 2 blocks: Heading, List.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 blocks' }));
    expect(cards()).toEqual(['Block 1, Paragraph', 'Block 2, Heading', 'Block 3, List']);
    expect(screen.getByRole('region', { name: 'Block 2, Heading' })).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Add a block' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(cards()).toEqual(['Block 1, Paragraph']);
  });

  it('goes back to the menu without adding anything', async () => {
    await renderEditor(withBlocks([]));
    fireEvent.click(within(openMenu()).getByRole('menuitem', { name: 'Paste text' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Text to turn into blocks' }), {
      target: { value: 'Wash for 20 seconds.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('searchbox', { name: 'Search blocks' })).toBeInTheDocument();
    expect(screen.getByText('This lesson is empty. Add a block to start.')).toBeInTheDocument();
  });
});

describe('Block templates', () => {
  it('saves a block as a template and adds copies of it from the menu', async () => {
    const client = testStudioClient();
    const { courseId } = await renderEditor(
      withBlocks([paragraph('block-1', 'Clean hands save lives.')]),
      client,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save block 1 as a template' }));
    const form = screen.getByRole('form', { name: 'Save as a template' });
    const name = within(form).getByRole('textbox', { name: 'Template name' });
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveValue('Paragraph');
    fireEvent.change(name, { target: { value: 'Why hands matter' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save template' }));

    expect(
      await screen.findByText('Saved “Why hands matter”. Find it under Templates in Add block.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save block 1 as a template' })).toHaveFocus();
    const saved = await client.listBlockTemplates();
    expect(saved.map(({ name, blocks }) => ({ name, blocks }))).toEqual([
      { name: 'Why hands matter', blocks: [paragraph('block-1', 'Clean hands save lives.')] },
    ]);

    // Twice, so the second copy needs ids of its own.
    for (const expected of [2, 3]) {
      const menu = openMenu();
      const templates = await within(menu).findByRole('group', { name: 'Templates' });
      fireEvent.click(within(templates).getByRole('menuitem', { name: 'Why hands matter' }));
      expect(cards()).toHaveLength(expected);
    }
    await waitFor(
      async () => {
        const [lesson] = (await client.getCourse(courseId)).course.lessons;
        const ids = lesson?.kind === 'content' ? lesson.blocks.map((block) => block.id) : [];
        expect(new Set(ids).size).toBe(3);
      },
      { timeout: 3000 },
    );
  });

  it("saves a lesson's blocks under the lesson's name, and asks for a name", async () => {
    const client = testStudioClient();
    await renderEditor(
      withBlocks([paragraph('block-1', 'Clean hands.'), paragraph('block-2', 'Every time.')]),
      client,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save blocks as a template' }));
    const form = screen.getByRole('form', { name: 'Save as a template' });
    const name = within(form).getByRole('textbox', { name: 'Template name' });
    expect(name).toHaveValue('Why it matters');
    expect(form).toHaveTextContent('2 blocks: Paragraph, Paragraph');
    fireEvent.change(name, { target: { value: '  ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save template' }));
    expect(await within(form).findByText('Give the template a name.')).toBeInTheDocument();

    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form', { name: 'Save as a template' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save blocks as a template' })).toHaveFocus();
    expect(await client.listBlockTemplates()).toEqual([]);
  });

  it('finds templates by name and deletes them after a second click', async () => {
    const client = testStudioClient();
    await client.saveBlockTemplate({ name: 'Hand rub steps', blocks: [paragraph('t-1', 'Rub.')] });
    await client.saveBlockTemplate({ name: 'Glove rules', blocks: [paragraph('t-2', 'Gloves.')] });
    await renderEditor(withBlocks([]), client);
    const menu = openMenu();
    await within(menu).findByRole('group', { name: 'Templates' });
    fireEvent.change(within(menu).getByRole('searchbox', { name: 'Search blocks' }), {
      target: { value: 'glove' },
    });
    expect(
      within(within(menu).getByRole('group', { name: 'Templates' })).getAllByRole('menuitem'),
    ).toHaveLength(1);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Manage templates' }));
    const list = screen.getByRole('list', { name: 'Templates' });
    fireEvent.click(within(list).getByRole('button', { name: 'Delete Glove rules' }));
    const confirm = within(list).getByRole('button', { name: 'Delete “Glove rules”' });
    await waitFor(() => expect(confirm).toHaveFocus());
    fireEvent.click(confirm);
    expect(await screen.findByText('Deleted “Glove rules”.')).toBeInTheDocument();
    expect((await client.listBlockTemplates()).map((t) => t.name)).toEqual(['Hand rub steps']);
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1));

    fireEvent.click(within(list).getByRole('button', { name: 'Delete Hand rub steps' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Keep it' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });
});
