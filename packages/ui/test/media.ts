import { act } from '@testing-library/react';

/** Fake device for window.matchMedia: dark mode on or off, and the window width. */
interface Device {
  dark: boolean;
  width: number;
}

const initial: Device = { dark: false, width: 1280 };
let device: Device = { ...initial };
const listeners = new Map<(event: MediaQueryListEvent) => void, string>();

function matches(query: string): boolean {
  return query.split(/\s+and\s+/).every((part) => {
    if (part.includes('prefers-color-scheme: dark')) return device.dark;
    const min = /min-width:\s*([\d.]+)px/.exec(part);
    if (min) return device.width >= Number(min[1]);
    const max = /max-width:\s*([\d.]+)px/.exec(part);
    if (max) return device.width <= Number(max[1]);
    return false;
  });
}

export function installMatchMedia(): void {
  window.matchMedia = (query: string) =>
    ({
      media: query,
      matches: matches(query),
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.set(listener, query);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }) as unknown as MediaQueryList;
}

/** Change the fake device and tell every listener, inside act(). */
export function setMedia(next: Partial<Device>): void {
  act(() => {
    device = { ...device, ...next };
    for (const [listener, query] of [...listeners]) {
      listener({ matches: matches(query), media: query } as MediaQueryListEvent);
    }
  });
}

export function resetMedia(): void {
  device = { ...initial };
  listeners.clear();
}
