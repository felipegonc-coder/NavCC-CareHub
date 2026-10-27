// A variable chip in the blocks a button inserts (and in templates): purple, "@Today".
import { NodeViewWrapper, type ReactNodeViewProps } from '@carehub/editor';
import {
  TEMPLATE_VARIABLES,
  variableLabel,
  type TemplateVariable,
} from '@carehub/extras/templates/content';
import { cn } from '@carehub/ui';

export function variableOf(attrs: Record<string, unknown>): {
  kind: TemplateVariable;
  offsetDays: number;
} {
  const kind = TEMPLATE_VARIABLES.includes(attrs.kind as TemplateVariable)
    ? (attrs.kind as TemplateVariable)
    : 'today';
  const days = Number(attrs.offsetDays ?? 0);
  return { kind, offsetDays: Number.isSafeInteger(days) ? days : 0 };
}

export function VariableChipView({ node, selected }: ReactNodeViewProps) {
  const { kind, offsetDays } = variableOf(node.attrs);
  return (
    <NodeViewWrapper
      as="span"
      data-template-variable=""
      className={cn(
        'rounded-sm bg-purple-bg px-1 text-purple-text',
        selected && 'outline outline-2 outline-primary',
      )}
    >
      @{variableLabel(kind, offsetDays)}
    </NodeViewWrapper>
  );
}
