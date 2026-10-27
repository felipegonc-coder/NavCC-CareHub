import type { AnyExtension } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';

// The code group. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [CodeBlock];
