import { textblockTypeInputRule, type AnyExtension } from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';

/** Code blocks. Three backticks make one as soon as they're typed, with no space (spec 3.6). */
const Code = CodeBlock.extend({
  addInputRules() {
    return [textblockTypeInputRule({ find: /^```$/, type: this.type }), ...(this.parent?.() ?? [])];
  },
});

// The code group. Schema only: rules in ./index.ts.
export const nodes: AnyExtension[] = [Code];
