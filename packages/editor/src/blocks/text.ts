import type { AnyExtension } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';

// The text group (Text itself is the core paragraph). Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [Heading.configure({ levels: [1, 2, 3] })];
