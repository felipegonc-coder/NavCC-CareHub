import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeSlots } from '../../slots';
import { databaseSlashItem } from './slash';
import { DatabaseBlockSlot, DatabasePageSlot, slots, stopBlockEvent } from './slots';
import { JOBS_ID, renderWithDatabase } from './test-utils';

vi.mock('./layouts', async () => {
  const { probeLayouts } = await import('./shell/test-layout');
  return { LAYOUTS: probeLayouts() };
});

beforeEach(() => {
  localStorage.clear();
});

describe('databases slots', () => {
  it('fill the page view, the editor block and the "/" menu', () => {
    const merged = mergeSlots([slots]);
    expect(merged.pageKindViews.database).toBe(DatabasePageSlot);
    expect(merged.editor.nodeViews).toEqual({
      database: { component: DatabaseBlockSlot, stopEvent: stopBlockEvent },
    });
    expect(merged.editor.slashItems).toEqual([databaseSlashItem]);
  });

  it("leave the block's events to it, except on its grip, and cancel drags of its box", () => {
    // The editor's outer element, around the block's view with its grip and another lane's
    // drag handle (a row's) inside.
    const box = document.createElement('div');
    box.innerHTML =
      '<div data-database-block=""><span data-drag-handle=""><b></b></span>' +
      '<button type="button">Filter</button><div><i data-drag-handle=""></i></div></div>';
    document.body.append(box);
    const send = (target: Element | null, type: string) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      let answer: boolean | undefined;
      box.addEventListener(type, (seen) => (answer = stopBlockEvent(seen)), { once: true });
      target?.dispatchEvent(event);
      return { answer, cancelled: event.defaultPrevented };
    };
    const grip = box.querySelector('b');
    expect(send(grip, 'mousedown')).toEqual({ answer: false, cancelled: false });
    expect(send(grip, 'dragstart')).toEqual({ answer: false, cancelled: false });
    expect(send(box.querySelector('button'), 'mousedown')).toEqual({
      answer: true,
      cancelled: false,
    });
    expect(send(box.querySelector('button'), 'paste')).toEqual({ answer: true, cancelled: false });
    expect(send(box.querySelector('i'), 'dragstart')).toEqual({ answer: true, cancelled: false });
    expect(send(box, 'dragstart')).toEqual({ answer: true, cancelled: true });
    box.remove();
  });

  it('load the database page on first use', async () => {
    renderWithDatabase(<DatabasePageSlot page={{ id: JOBS_ID }} />, { route: `/p/${JOBS_ID}` });
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByTestId('database')).toHaveAttribute('data-database-id', JOBS_ID);
  });

  it('load the inline block on first use', async () => {
    renderWithDatabase(<DatabaseBlockSlot node={{ attrs: { databaseId: JOBS_ID } }} />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Jobs' })).toBeInTheDocument();
  });
});
