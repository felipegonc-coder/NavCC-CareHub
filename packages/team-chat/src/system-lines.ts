import { z } from 'zod';
import { listNames, personName } from './names';
import type { NameOf } from './types';

/** A change to a group, stored as a small line in the chat and shown with current names. */
export const systemEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('started'), actorId: z.string(), name: z.string().nullable() }),
  z.object({ kind: z.literal('renamed'), actorId: z.string(), name: z.string().nullable() }),
  z.object({ kind: z.literal('added'), actorId: z.string(), userIds: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('removed'), actorId: z.string(), userId: z.string() }),
  z.object({ kind: z.literal('left'), userId: z.string() }),
  z.object({ kind: z.literal('tookOver'), userId: z.string() }),
]);
export type SystemEvent = z.infer<typeof systemEventSchema>;

/** "Avery Lin added Sam Ortiz and Riley Chen", "Sam Ortiz left", and so on. */
export function systemLineText(event: SystemEvent, nameOf: NameOf): string {
  const name = (userId: string) => personName(nameOf(userId));
  switch (event.kind) {
    case 'started':
      return event.name
        ? `${name(event.actorId)} started the group '${event.name}'`
        : `${name(event.actorId)} started the group`;
    case 'renamed':
      return event.name
        ? `${name(event.actorId)} renamed the group to '${event.name}'`
        : `${name(event.actorId)} removed the group name`;
    case 'added':
      return `${name(event.actorId)} added ${listNames(event.userIds.map(name), 3)}`;
    case 'removed':
      return `${name(event.actorId)} removed ${name(event.userId)}`;
    case 'left':
      return `${name(event.userId)} left`;
    case 'tookOver':
      return `${name(event.userId)} can now remove people`;
  }
}
