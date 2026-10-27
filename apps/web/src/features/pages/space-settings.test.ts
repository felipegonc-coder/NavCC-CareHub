import { describe, expect, it } from 'vitest';
import { applyChange, settingsOf, undoOf, type SpaceSettings } from './space-settings';

// A fictional space, as its owner sees its settings.
const care: SpaceSettings = {
  id: 'care',
  kind: 'closed',
  name: 'Care team',
  icon: null,
  description: 'Rotas and handovers.',
  defaultAccess: 'edit',
  topLevel: 'members',
  security: { shareLinks: true, guests: false, export: true, moveOut: true },
  workspaceAllows: { shareLinks: true, guests: true, export: true, moveOut: true },
  canManage: true,
};

describe('settingsOf', () => {
  it('reads the space from the reply', () => {
    expect(settingsOf({ space: care })).toEqual(care);
    expect(settingsOf(care)).toEqual(care);
  });

  it('fills in what the server leaves out', () => {
    expect(settingsOf({ space: { id: 'care', name: 'Care team' } })).toEqual({
      id: 'care',
      kind: 'open',
      name: 'Care team',
      icon: null,
      description: '',
      defaultAccess: 'edit',
      topLevel: 'members',
      security: { shareLinks: true, guests: true, export: true, moveOut: true },
      workspaceAllows: { shareLinks: true, guests: true, export: true, moveOut: true },
      canManage: false,
    });
  });

  it("keeps a switch off while the workspace doesn't allow it", () => {
    const settings = settingsOf({
      space: { ...care, workspaceAllows: { ...care.workspaceAllows, export: false } },
    });
    expect(settings?.security.export).toBe(false);
  });

  it('gives null without a space', () => {
    expect(settingsOf(null)).toBeNull();
    expect(settingsOf({ space: { id: 'care' } })).toBeNull();
  });
});

describe('applyChange and undoOf', () => {
  it('changes only the fields asked for, and puts them back', () => {
    const change = { name: 'Care', security: { guests: true } };
    const changed = applyChange(care, change);
    expect(changed).toEqual({
      ...care,
      name: 'Care',
      security: { ...care.security, guests: true },
    });
    expect(undoOf(care, change)).toEqual({ name: 'Care team', security: { guests: false } });
    expect(applyChange(changed, undoOf(care, change))).toEqual(care);
  });

  it('takes away an icon', () => {
    const withIcon = { ...care, icon: { type: 'emoji', emoji: '🩺' } as const };
    expect(applyChange(withIcon, { icon: null }).icon).toBeNull();
    expect(undoOf(withIcon, { icon: null })).toEqual({ icon: { type: 'emoji', emoji: '🩺' } });
  });
});
