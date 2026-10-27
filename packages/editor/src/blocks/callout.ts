import type { AnyExtension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';

// The callout group: callout, quote and divider. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [Blockquote, HorizontalRule];
