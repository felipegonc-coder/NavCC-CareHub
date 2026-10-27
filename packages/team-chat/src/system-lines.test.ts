import { describe, expect, it } from 'vitest';
import { systemEventSchema, systemLineText } from './system-lines';
import type { SystemEvent } from './system-lines';
import type { PersonLabel } from './types';

const people: Record<string, PersonLabel> = {
  avery: { name: 'Avery Lin' },
  sam: { name: 'Sam Ortiz' },
  riley: { name: 'Riley Chen' },
  jordan: { name: 'Jordan Patel' },
  morgan: { name: 'Morgan Lee', removed: true },
  casey: { name: 'Casey Nguyen' },
};
const line = (event: SystemEvent) => systemLineText(event, (id) => people[id]);

describe('systemLineText', () => {
  it('writes each change as a small line', () => {
    const cases: [SystemEvent, string][] = [
      [{ kind: 'started', actorId: 'avery', name: null }, 'Avery Lin started the group'],
      [
        { kind: 'started', actorId: 'avery', name: 'Care Team Demo' },
        "Avery Lin started the group 'Care Team Demo'",
      ],
      [
        { kind: 'renamed', actorId: 'sam', name: 'Stand-up' },
        "Sam Ortiz renamed the group to 'Stand-up'",
      ],
      [{ kind: 'renamed', actorId: 'sam', name: null }, 'Sam Ortiz removed the group name'],
      [{ kind: 'added', actorId: 'avery', userIds: ['sam'] }, 'Avery Lin added Sam Ortiz'],
      [{ kind: 'removed', actorId: 'avery', userId: 'riley' }, 'Avery Lin removed Riley Chen'],
      [{ kind: 'left', userId: 'jordan' }, 'Jordan Patel left'],
      [{ kind: 'tookOver', userId: 'sam' }, 'Sam Ortiz can now remove people'],
    ];
    for (const [event, text] of cases) expect(line(event)).toBe(text);
  });

  it('lists several people added at once', () => {
    const added = (userIds: string[]) => line({ kind: 'added', actorId: 'avery', userIds });
    expect(added(['sam', 'riley'])).toBe('Avery Lin added Sam Ortiz and Riley Chen');
    expect(added(['sam', 'riley', 'jordan', 'casey'])).toBe(
      'Avery Lin added Sam Ortiz, Riley Chen, Jordan Patel and Casey Nguyen',
    );
    expect(added(['sam', 'riley', 'jordan', 'casey', 'morgan'])).toBe(
      'Avery Lin added Sam Ortiz, Riley Chen, Jordan Patel and 2 others',
    );
  });

  it('shows current names, with "(removed)" for people removed from the workspace', () => {
    expect(line({ kind: 'left', userId: 'morgan' })).toBe('Morgan Lee (removed) left');
    expect(line({ kind: 'left', userId: 'nobody' })).toBe('Unknown person left');
  });
});

describe('systemEventSchema', () => {
  it('reads stored events and refuses broken ones', () => {
    const stored = { kind: 'added', actorId: 'avery', userIds: ['sam'] };
    expect(systemEventSchema.parse(stored)).toEqual(stored);
    expect(systemEventSchema.safeParse({ ...stored, userIds: [] }).success).toBe(false);
    expect(systemEventSchema.safeParse({ kind: 'archived', userId: 'sam' }).success).toBe(false);
  });
});
