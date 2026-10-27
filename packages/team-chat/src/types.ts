/** Shapes used across the package. IDs are opaque strings (see `ID_PATTERN`). */

export type ChatType = 'direct' | 'group' | 'careHub';

/** A person's message, a notice in the 🔔 Care Hub chat, or a small line such as "Avery Lin left". */
export type MessageKind = 'message' | 'notice' | 'system';

export type AttachmentKind = 'picture' | 'video' | 'audio' | 'pdf' | 'file';

/** How a person is shown. `removed` means they were removed from the workspace. */
export interface PersonLabel {
  name: string;
  removed?: boolean;
}

/** Looks up a person by user ID; `undefined` when unknown. */
export type NameOf = (userId: string) => PersonLabel | undefined;
