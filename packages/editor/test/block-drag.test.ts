import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  blockAt,
  blocksEndingWith,
  dropPos,
  insertLine,
  moveBlocks,
  moveTarget,
  selectedBlocks,
  selectionIn,
  type Block,
  type MoveOptions,
  type Place,
} from '../src/block-drag';
import { createPageSchema } from '../src/schema';

const schema = createPageSchema();

const p = (text = '') => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const li = (...content: ProseMirrorNode[]) => schema.node('listItem', null, content);
const ul = (...items: ProseMirrorNode[]) => schema.node('bulletList', null, items);
const ol = (start: number, ...items: ProseMirrorNode[]) =>
  schema.node('orderedList', { start }, items);
const todo = (...content: ProseMirrorNode[]) =>
  schema.node('taskItem', { checked: false }, content);
const todos = (...items: ProseMirrorNode[]) => schema.node('taskList', null, items);
const quote = (...content: ProseMirrorNode[]) => schema.node('blockquote', null, content);
const hr = () => schema.node('horizontalRule');
const doc = (...content: ProseMirrorNode[]) => schema.node('doc', null, content);

const SHORT: Record<string, string> = {
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  taskList: 'todos',
  taskItem: 'todo',
  blockquote: 'quote',
  horizontalRule: 'hr',
};

/** A node in short: a line is its text (`_` when empty), `ol@3(...)` a list that starts at 3. */
function outline(node: ProseMirrorNode): string {
  if (node.isTextblock) return node.textContent || '_';
  const children: string[] = [];
  node.forEach((child) => children.push(outline(child)));
  if (node.type.name === 'doc') return children.join(' ');
  const start: unknown = node.attrs.start;
  const counting = typeof start === 'number' && start !== 1 ? `@${start}` : '';
  const name = `${SHORT[node.type.name] ?? node.type.name}${counting}`;
  return children.length > 0 ? `${name}(${children.join(' ')})` : name;
}

/** Where the line with `text` starts. */
function lineAt(page: ProseMirrorNode, text: string): number {
  let found = -1;
  page.descendants((node, pos) => {
    if (found < 0 && node.isTextblock && node.textContent === text) found = pos;
    return found < 0;
  });
  if (found < 0) throw new Error(`No line "${text}"`);
  return found;
}

/** The block the line with `text` belongs to. */
function blockOf(page: ProseMirrorNode, text: string): Block {
  const block = blockAt(page, lineAt(page, text));
  if (!block) throw new Error(`No block at "${text}"`);
  return block;
}

/** Moves the blocks of the lines `texts` to `place` of the block of the line `to`. */
function move(
  page: ProseMirrorNode,
  texts: string[],
  place: Place,
  to: string,
  options?: MoveOptions,
) {
  const tr = EditorState.create({ doc: page }).tr;
  const blocks = texts.map((text) => blockOf(page, text));
  const landed = moveBlocks(tr, blocks, dropPos(blockOf(page, to), place), options);
  return {
    page: outline(tr.doc),
    landed: landed?.map((block) => outline(block.node)) ?? null,
    changed: tr.docChanged,
    tr,
  };
}

describe('blockAt', () => {
  it('finds the block a position belongs to', () => {
    const page = doc(p('Intake'), hr(), p('Notes'));
    expect(outline(blockOf(page, 'Intake').node)).toBe('Intake');
    // In the text, and right before the block.
    expect(blockAt(page, lineAt(page, 'Notes') + 3)?.pos).toBe(lineAt(page, 'Notes'));
    expect(blockAt(page, 8)?.node.type.name).toBe('horizontalRule');
    // At the end of the page: the last block.
    expect(outline(blockAt(page, page.content.size)?.node ?? page)).toBe('Notes');
  });

  it('takes a list by its items, and a list item, to-do or quote by its first line', () => {
    const page = doc(
      ul(li(p('Call back'), ul(li(p('Ward 4'))), p('Ask about meds'))),
      todos(todo(p('Book transport'))),
      quote(p('Quote'), p('Second line')),
    );
    expect(outline(blockOf(page, 'Call back').node)).toBe(
      'li(Call back ul(li(Ward 4)) Ask about meds)',
    );
    // Right before the list: its first item.
    expect(blockAt(page, 0)?.pos).toBe(1);
    expect(outline(blockOf(page, 'Ward 4').node)).toBe('li(Ward 4)');
    // A line of its own in a list item.
    expect(outline(blockOf(page, 'Ask about meds').node)).toBe('Ask about meds');
    expect(outline(blockOf(page, 'Book transport').node)).toBe('todo(Book transport)');
    expect(outline(blockOf(page, 'Quote').node)).toBe('quote(Quote Second line)');
    expect(outline(blockOf(page, 'Second line').node)).toBe('Second line');
  });
});

describe('blocksEndingWith', () => {
  it('lists the blocks a block is the last thing in, innermost first', () => {
    const page = doc(ul(li(p('Call back'), ul(li(p('Ward 4'))))), quote(p('Quote'), p('End')));
    const levels = (text: string) =>
      blocksEndingWith(page, blockOf(page, text)).map((block) => outline(block.node));
    expect(levels('Ward 4')).toEqual(['li(Ward 4)', 'li(Call back ul(li(Ward 4)))']);
    expect(levels('End')).toEqual(['End', 'quote(Quote End)']);
    expect(levels('Quote')).toEqual(['quote(Quote End)']);
  });
});

describe('selectedBlocks', () => {
  const page = doc(p('Intake'), ul(li(p('Call back')), li(p('Book transport'))), p('Notes'));
  const select = (from: number, to = from) =>
    selectedBlocks(
      EditorState.create({ doc: page, selection: TextSelection.create(page, from, to) }),
    ).map((block) => outline(block.node));

  it('takes the block the cursor is in', () => {
    expect(select(lineAt(page, 'Book transport') + 2)).toEqual(['li(Book transport)']);
  });

  it('takes every block the selection reaches, and of a list only the items it reaches', () => {
    expect(select(2, lineAt(page, 'Call back') + 3)).toEqual(['Intake', 'li(Call back)']);
    expect(select(lineAt(page, 'Call back') + 2, lineAt(page, 'Notes') + 2)).toEqual([
      'li(Call back)',
      'li(Book transport)',
      'Notes',
    ]);
  });

  it('takes a selected block', () => {
    const state = EditorState.create({
      doc: page,
      selection: NodeSelection.create(page, blockOf(page, 'Call back').pos),
    });
    expect(selectedBlocks(state).map((block) => outline(block.node))).toEqual(['li(Call back)']);
  });
});

describe('moveBlocks', () => {
  const lines = doc(p('A'), p('B'), p('C'));

  it('moves a block down or up, where it keeps its ID', () => {
    expect(move(lines, ['A'], 'after', 'C')).toMatchObject({ page: 'B C A', landed: ['A'] });
    expect(move(lines, ['C'], 'before', 'A').page).toBe('C A B');
    const withId = doc(schema.node('paragraph', { blockId: 'intake' }, [schema.text('A')]), p('B'));
    expect(move(withId, ['A'], 'after', 'B').tr.doc.lastChild?.attrs.blockId).toBe('intake');
  });

  it('changes nothing when blocks are dropped next to themselves', () => {
    expect(move(lines, ['B'], 'after', 'A')).toMatchObject({ page: 'A B C', changed: false });
    expect(move(lines, ['B'], 'before', 'C').changed).toBe(false);
    // The only block of the page, and the only item of a numbered list.
    expect(move(doc(p('A')), ['A'], 'after', 'A')).toMatchObject({ page: 'A', changed: false });
    const numbered = doc(p('P'), ol(3, li(p('A'))), p('Q'));
    expect(move(numbered, ['A'], 'after', 'P').changed).toBe(false);
    expect(move(numbered, ['A'], 'before', 'Q').changed).toBe(false);
  });

  it('moves several blocks in page order, and copies them', () => {
    expect(move(lines, ['B', 'A'], 'after', 'C')).toMatchObject({
      page: 'C A B',
      landed: ['A', 'B'],
    });
    expect(move(lines, ['A'], 'after', 'C', { copy: true })).toMatchObject({
      page: 'A B C A',
      landed: ['A'],
    });
  });

  it('refuses to move blocks into themselves', () => {
    const page = doc(ul(li(p('A'), ul(li(p('B'))))), p('C'));
    const result = move(page, ['A'], 'after', 'B');
    expect(result).toMatchObject({ landed: null, changed: false });
    expect(result.tr.steps).toHaveLength(0);
  });

  it('moves a list item with the blocks nested in it', () => {
    const page = doc(ul(li(p('A'), ul(li(p('A1')))), li(p('B'))), p('P'));
    expect(move(page, ['A'], 'after', 'P').page).toBe('ul(li(B)) P ul(li(A ul(li(A1))))');
  });

  it('gives a list item dropped outside a list a list of its own kind', () => {
    const page = doc(p('P'), ul(li(p('A')), li(p('B')), li(p('C'))), p('Q'));
    expect(move(page, ['B'], 'after', 'Q')).toMatchObject({
      page: 'P ul(li(A) li(C)) Q ul(li(B))',
      landed: ['li(B)'],
    });
    // Two items of a list stay in one list.
    expect(move(page, ['A', 'B'], 'after', 'Q').page).toBe('P ul(li(C)) Q ul(li(A) li(B))');
  });

  it('splits a list when another kind of block is dropped between its items', () => {
    const page = doc(p('P'), ul(li(p('A')), li(p('B')), li(p('C'))), p('Q'));
    expect(move(page, ['Q'], 'after', 'A').page).toBe('P ul(li(A)) Q ul(li(B) li(C))');
    // At the start or the end of the list: before or after it.
    expect(move(page, ['Q'], 'before', 'A').page).toBe('P Q ul(li(A) li(B) li(C))');
    expect(move(page, ['P'], 'after', 'C').page).toBe('ul(li(A) li(B) li(C)) P Q');
    // A to-do between bulleted items.
    const mixed = doc(ul(li(p('A')), li(p('B'))), todos(todo(p('T'))));
    expect(move(mixed, ['T'], 'after', 'A').page).toBe('ul(li(A)) todos(todo(T)) ul(li(B))');
    // The second part of a numbered list counts from 1.
    const numbered = doc(ol(3, li(p('A')), li(p('B'))), p('P'));
    expect(move(numbered, ['P'], 'after', 'A').page).toBe('ol@3(li(A)) P ol(li(B))');
  });

  it('puts list items dropped in a list of the same kind straight in', () => {
    const page = doc(ul(li(p('A')), li(p('B'))), p('P'), ul(li(p('C'))));
    expect(move(page, ['C'], 'after', 'A')).toMatchObject({
      page: 'ul(li(A) li(C) li(B)) P',
      landed: ['li(C)'],
    });
    // A nested item dropped after the item it is in moves out a level.
    const nested = doc(ul(li(p('A'), ul(li(p('A1')))), li(p('B'))), p('P'));
    expect(move(nested, ['A1'], 'after', 'A').page).toBe('ul(li(A) li(A1) li(B)) P');
  });

  it('joins lists of the same kind that end up side by side', () => {
    const page = doc(ul(li(p('A')), li(p('B'))), p('P'), ul(li(p('C'))));
    expect(move(page, ['P'], 'before', 'A').page).toBe('P ul(li(A) li(B) li(C))');
    // A list that was there keeps counting as it did.
    const numbered = doc(ol(1, li(p('Z'))), p('P'), ol(3, li(p('A')), li(p('B'))));
    expect(move(numbered, ['Z'], 'after', 'P').page).toBe('P ol@3(li(Z) li(A) li(B))');
  });

  it('nests blocks dropped inside a list item or a quote, at the top', () => {
    const page = doc(ul(li(p('A'), ul(li(p('A1')))), li(p('B'))), p('P'), quote(p('Q'), p('Q2')));
    expect(move(page, ['P'], 'inside', 'A').page).toBe('ul(li(A P ul(li(A1))) li(B)) quote(Q Q2)');
    expect(move(page, ['B'], 'inside', 'A').page).toBe('ul(li(A ul(li(B) li(A1)))) P quote(Q Q2)');
    expect(move(page, ['P'], 'inside', 'Q').page).toBe('ul(li(A ul(li(A1))) li(B)) quote(Q P Q2)');
  });
});

describe('moveTarget', () => {
  /** The page after the blocks of the lines `texts` move one place up (-1) or down (1). */
  function step(page: ProseMirrorNode, texts: string[], dir: -1 | 1) {
    const blocks = texts.map((text) => blockOf(page, text));
    const target = moveTarget(page, blocks, dir);
    const tr = EditorState.create({ doc: page }).tr;
    return target !== null && moveBlocks(tr, blocks, target) ? outline(tr.doc) : null;
  }

  it('moves blocks past the block above or below, and not past the top or bottom', () => {
    const lines = doc(p('A'), p('B'), p('C'));
    expect(step(lines, ['B'], -1)).toBe('B A C');
    expect(step(lines, ['B'], 1)).toBe('A C B');
    expect(step(lines, ['A', 'B'], 1)).toBe('C A B');
    expect(step(lines, ['A'], -1)).toBeNull();
    expect(step(lines, ['C'], 1)).toBeNull();
  });

  it('moves list items among each other, and out of the list at its top or bottom', () => {
    const page = doc(p('P'), ul(li(p('A')), li(p('B'))), p('Q'));
    expect(step(page, ['B'], -1)).toBe('P ul(li(B) li(A)) Q');
    expect(step(page, ['A'], -1)).toBe('ul(li(A)) P ul(li(B)) Q');
    expect(step(page, ['B'], 1)).toBe('P ul(li(A)) Q ul(li(B))');
    // A nested item at the top of its list moves out, above the item it was in.
    const nested = doc(ul(li(p('A'), ul(li(p('B'))))));
    expect(step(nested, ['B'], -1)).toBe('ul(li(B) li(A))');
  });

  it('moves blocks into and out of a block with blocks nested in it', () => {
    const page = doc(ul(li(p('A'), p('A2'))), p('P'));
    expect(step(page, ['P'], -1)).toBe('ul(li(A A2 P))');
    const inside = doc(ul(li(p('A'), p('A2'), p('P'))));
    expect(step(inside, ['P'], 1)).toBe('ul(li(A A2)) P');
    const quoted = doc(p('X'), quote(p('Q'), p('Q2')));
    expect(step(quoted, ['X'], 1)).toBe('quote(Q X Q2)');
    expect(step(quoted, ['Q2'], -1)).toBe('X Q2 quote(Q)');
  });
});

describe('insertLine', () => {
  it('adds an empty line between blocks, splitting a list', () => {
    const page = doc(p('A'), ul(li(p('B')), li(p('C'))));
    const tr = EditorState.create({ doc: page }).tr;
    const pos = insertLine(tr, dropPos(blockOf(page, 'B'), 'after'));
    expect(outline(tr.doc)).toBe('A ul(li(B)) _ ul(li(C))');
    expect(pos === null ? null : tr.doc.nodeAt(pos)?.content.size).toBe(0);
  });
});

describe('selectionIn', () => {
  it('puts the cursor at the end of the first moved line, or selects a block with no text', () => {
    const page = doc(p('Intake'), hr());
    const text = selectionIn(page, [blockOf(page, 'Intake')]);
    expect(text instanceof TextSelection && text.from).toBe(7);
    const divider = selectionIn(page, [{ node: hr(), pos: 8 }]);
    expect(divider instanceof NodeSelection && divider.from).toBe(8);
  });
});
