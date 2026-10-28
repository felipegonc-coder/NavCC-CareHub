import type { JSONContent } from '@tiptap/core';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RichTextField, type RichTextFieldProps } from '../src';
import { flush } from './helpers';

// Draws the toolbar where the floating menu would be, so a test sees whether the field has one.
// (The real menu waits for focus and a pause, which these tests don't need.)
vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children?: unknown }) => children,
}));

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

const value: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Room 4' }] }],
};

async function toolbarOf(props: Partial<RichTextFieldProps>) {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root?.render(
      <RichTextField value={value} onChange={() => undefined} ariaLabel="Room" {...props} />,
    ),
  );
  await act(flush);
  return container.querySelector('[role="toolbar"]');
}

describe('RichTextField selection toolbar', () => {
  it('is there when marks are allowed', async () => {
    expect(await toolbarOf({ marks: ['bold'] })).not.toBeNull();
  });

  it('is left out when no marks are allowed', async () => {
    expect(await toolbarOf({ marks: [] })).toBeNull();
  });

  it('is left out when read-only', async () => {
    expect(await toolbarOf({ readOnly: true })).toBeNull();
  });
});
