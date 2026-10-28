import { wrappingInputRule, type AnyExtension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';

/** Quotes. `"` and a space make one (spec 3.6), also with a curly quote; `>` makes a toggle. */
const Quote = Blockquote.extend({
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*["\u201c]\s$/, type: this.type })];
  },
});

// The callout group: callout, quote and divider. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [Quote, HorizontalRule];
