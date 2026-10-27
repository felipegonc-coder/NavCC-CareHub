/** Shared by the cells' tests: Blue Pine Plumbing's people and rows, and an editor to open. */
import type { NumberDisplay, Property, PropertyConfig } from '@carehub/databases';
import { act, fireEvent, render } from '@testing-library/react';
import { vi } from 'vitest';
import { testViewer, USERS } from '../fixtures';
import { CellEditor } from './cell-editor';
import type { CellContext, CellEditorProps } from './types';

const PEOPLE: Record<string, string> = {
  [USERS.avery.id]: USERS.avery.name,
  [USERS.jordan.id]: USERS.jordan.name,
};

/** Rows of a Customers database: the viewer can open the first two, not the last. */
export const CUSTOMERS = {
  bluePine: 'row-blue-pine',
  untitled: 'row-untitled',
  hidden: 'row-hidden',
} as const;

const TITLES: Record<string, string> = {
  [CUSTOMERS.bluePine]: 'Blue Pine Plumbing',
  [CUSTOMERS.untitled]: '',
};

let made = 0;

/** A property of any type, called "Field" unless named. */
export function prop(config: PropertyConfig, name = 'Field'): Property {
  made += 1;
  return { id: `prop-test-${made}`, name, description: '', config, rowPage: 'always' };
}

/** A Number property's settings: a plain number unless changed. */
export function numberConfig(display: Partial<NumberDisplay> = {}): PropertyConfig {
  return {
    type: 'number',
    format: 'number',
    currency: 'USD',
    decimals: 'auto',
    showAs: 'number',
    color: 'default',
    divideBy: null,
    showNumber: true,
    ...display,
  };
}

/** Avery Lin viewing in Denver, with Jordan Park and the Customers rows known by name. */
export function cellCtx(overrides: Partial<CellContext> = {}): CellContext {
  return {
    viewer: testViewer(),
    userName: (id) => PEOPLE[id],
    rowTitle: (id) => TITLES[id],
    ...overrides,
  };
}

/**
 * Lets overlays finish what they do a tick late: listening for presses outside once open, and
 * giving focus back once closed. The second wait is for timers that the first one's last render
 * started (act renders at its end, so a close that a saved write causes starts its timer there).
 */
export async function settle(ms = 10): Promise<void> {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

/** A press outside the open editor. */
export function pressOutside(): void {
  fireEvent.pointerDown(document.body);
}

export type EditorOptions = Partial<CellEditorProps> & Pick<CellEditorProps, 'property'>;

/** Opens a CellEditor over a cell; onCommit and onCancel are mocks. */
export async function openEditor(options: EditorOptions) {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  const view = render(
    <div className="relative">
      <CellEditor
        value={null}
        ctx={cellCtx()}
        onCommit={onCommit}
        onCancel={onCancel}
        {...options}
      />
    </div>,
  );
  await settle();
  return { ...view, onCommit, onCancel };
}
