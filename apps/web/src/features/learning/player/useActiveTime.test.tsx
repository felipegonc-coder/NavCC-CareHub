import type { Id } from '@carehub/learning';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useActiveTime } from './useActiveTime';

let now = 1_000_000;
const later = (seconds: number) => {
  now += seconds * 1000;
};

function track(lessonId: Id | null) {
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  const emit = vi.fn();
  function Probe() {
    const { flush } = useActiveTime(lessonId, emit);
    return <button onClick={flush}>Send now</button>;
  }
  const view = render(<Probe />);
  return { emit, close: view.unmount };
}

const spent = (seconds: number) => ({ type: 'time_active', lessonId: 'calls-before', seconds });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useActiveTime', () => {
  it('counts time while the learner is active and sends the rest when the lesson closes', () => {
    const { emit, close } = track('calls-before');
    later(20);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(emit).not.toHaveBeenCalled();
    later(5);
    close();
    expect(emit.mock.calls).toEqual([[spent(25)]]);
  });

  it('sends each whole minute as it fills up', () => {
    const { emit, close } = track('calls-before');
    later(50);
    fireEvent.scroll(window);
    later(20);
    fireEvent.pointerDown(window);
    expect(emit.mock.calls).toEqual([[spent(60)]]);
    later(5);
    close();
    expect(emit.mock.calls).toEqual([[spent(60)], [spent(15)]]);
  });

  it('stops counting a minute after the last thing the learner did', () => {
    const { emit, close } = track('calls-before');
    later(10);
    fireEvent.keyDown(window, { key: 'Tab' });
    later(600);
    close();
    expect(emit.mock.calls).toEqual([[spent(60)], [spent(10)]]);
  });

  it('sends what is counted on request, then keeps counting', () => {
    const { emit, close } = track('calls-before');
    later(20);
    fireEvent.click(screen.getByRole('button', { name: 'Send now' }));
    expect(emit.mock.calls).toEqual([[spent(20)]]);
    later(10);
    close();
    expect(emit.mock.calls).toEqual([[spent(20)], [spent(10)]]);
  });

  it('counts nothing without an open lesson', () => {
    const { emit, close } = track(null);
    later(30);
    fireEvent.keyDown(window, { key: 'a' });
    close();
    expect(emit).not.toHaveBeenCalled();
  });
});
