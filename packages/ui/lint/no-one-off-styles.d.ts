import type { ESLint, Rule } from 'eslint';

export interface Finding {
  kind: 'arbitrary' | 'notKit' | 'colour' | 'size';
  value: string;
  /** For `notKit`: the kit's classes to use instead. */
  use?: string;
}

export function findOneOffs(text: string): Finding[];
export function findStyleOneOff(property: string, value: unknown): Finding | null;
export const noOneOffStyles: Rule.RuleModule;

declare const plugin: ESLint.Plugin;
export default plugin;
