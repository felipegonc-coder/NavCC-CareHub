// Where the assistant panel is and what it shows (Claude features spec, section 2): open or closed;
// Floating, Side panel or Full screen, with the side panel's width, remembered per person on this
// device; and the chat on show. Ctrl+Alt+J opens and closes it (CL-18).
import { useSyncExternalStore } from 'react';

export const PANEL_LAYOUTS = ['floating', 'side', 'full'] as const;
export type PanelLayout = (typeof PANEL_LAYOUTS)[number];

export const LAYOUT_LABELS: Readonly<Record<PanelLayout, string>> = {
  floating: 'Floating',
  side: 'Side panel',
  full: 'Full screen',
};

/** Floating: 400 × 600 px at the bottom right (the spec's size; the kit has none like it). */
export const FLOATING_SIZE = { width: 400, height: 600 } as const;
/** Side panel: on the right, 320 to 640 px wide. */
export const SIDE_WIDTH = { min: 320, max: 640, start: 400 } as const;
/** Wider and Narrower in the layout menu change the side panel's width this much. */
export const SIDE_STEP = 80;

export interface PanelState {
  /** Who is signed in: their chats and layout. Null until known. */
  person: string | null;
  open: boolean;
  layout: PanelLayout;
  sideWidth: number;
  /** The chat on show; null before the first question of a new chat. */
  chatId: string | null;
}

type Remembered = Pick<PanelState, 'layout' | 'sideWidth'>;

const STORAGE_PREFIX = 'carehub.claude.assistant.';
const FIRST: Remembered = { layout: 'floating', sideWidth: SIDE_WIDTH.start };

let state: PanelState = { person: null, open: false, chatId: null, ...FIRST };
/** What had focus when the panel opened, to go back to when it closes. */
let openedFrom: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function clampWidth(width: number): number {
  return Math.round(Math.min(SIDE_WIDTH.max, Math.max(SIDE_WIDTH.min, width)));
}

function update(next: Partial<PanelState>): void {
  state = { ...state, ...next };
  for (const listener of [...listeners]) listener();
}

function remembered(userId: string): Remembered {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_PREFIX + userId) ?? 'null',
    ) as Partial<Remembered> | null;
    return {
      layout: PANEL_LAYOUTS.find((layout) => layout === saved?.layout) ?? FIRST.layout,
      sideWidth:
        typeof saved?.sideWidth === 'number' ? clampWidth(saved.sideWidth) : FIRST.sideWidth,
    };
  } catch {
    return FIRST;
  }
}

function remember(): void {
  const { person, layout, sideWidth } = state;
  if (!person) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + person, JSON.stringify({ layout, sideWidth }));
  } catch {
    // Storage can be full or blocked; the choice then lasts until the page reloads.
  }
}

/**
 * Who is signed in: their layout comes back. When someone else signs in on this tab, the panel
 * closes and forgets the chat on show.
 */
export function setPanelPerson(userId: string | null): void {
  if (userId === state.person) return;
  const switched = state.person !== null;
  update({
    person: userId,
    ...(userId ? remembered(userId) : FIRST),
    ...(switched ? { open: false, chatId: null } : {}),
  });
}

export function panelState(): PanelState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePanel(): PanelState {
  return useSyncExternalStore(subscribe, panelState, panelState);
}

export function openAssistant(): void {
  if (state.open) return;
  // A click doesn't focus a button in every browser, so focus may still be on the page itself.
  const active = document.activeElement;
  openedFrom = active instanceof HTMLElement && active !== document.body ? active : null;
  update({ open: true });
}

/** Closes the panel; gives back what had focus before it opened, if it's still there. */
export function closeAssistant(): HTMLElement | null {
  if (!state.open) return null;
  update({ open: false });
  const back = openedFrom?.isConnected ? openedFrom : null;
  openedFrom = null;
  return back;
}

export function setPanelLayout(layout: PanelLayout): void {
  update({ layout });
  remember();
}

export function setSideWidth(width: number): void {
  update({ sideWidth: clampWidth(width) });
  remember();
}

export function showChat(chatId: string | null): void {
  update({ chatId });
}

/** Ctrl+Alt+J, or ⌘⌥J on a Mac. Ctrl+J alone is writing help's. */
export function isAssistantKey(event: KeyboardEvent): boolean {
  const isJ = event.code === 'KeyJ' || event.key.toLowerCase() === 'j';
  return isJ && event.altKey && (event.ctrlKey || event.metaKey) && !event.shiftKey;
}
