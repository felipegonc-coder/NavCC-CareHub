import { describe, expect, it, vi } from 'vitest';
import { slots } from './slots';

describe('Analytics slots', () => {
  it('adds "Open Analytics" to the command menu, for Admins only', () => {
    const [command] = slots.commands ?? [];
    expect(command?.permission).toBe('workspace.admin');
    const navigate = vi.fn();
    void command?.run({ navigate });
    expect(navigate).toHaveBeenCalledWith('/analytics');
  });
});
