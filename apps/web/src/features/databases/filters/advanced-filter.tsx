/**
 * The advanced filter (Databases spec 3.2 and 3.4): "All of" and "Any of" groups nested up to 3
 * layers, up to 50 rules. Add a rule or a group, duplicate or delete either, or delete the filter.
 */
import type { FilterCondition, FilterGroup } from '@carehub/databases';
import { countConditions } from '@carehub/databases/filter';
import { Button, IconButton } from '@carehub/ui';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { NativeSelect } from '../cells/controls';
import {
  addGroup,
  addRule,
  canNest,
  duplicateNode,
  hasRoom,
  removeNode,
  setCombinator,
  type Combinator,
} from './filter-model';
import { FILTER_TEXT } from './messages';
import { RuleFields, type Editing } from './rule-fields';
import { ruleText } from './rule-text';

export function AdvancedFilter({ editing, onDelete }: { editing: Editing; onDelete(): void }) {
  const { root } = editing;
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-small font-semibold text-fg">{FILTER_TEXT.advancedFilter}</h2>
      <GroupEditor group={root} depth={1} editing={editing} />
      {!hasRoom(root) && <p className="text-label text-muted">{FILTER_TEXT.maxConditions}</p>}
      {root.children.length > 0 && (
        <Button variant="ghost" size="sm" onClick={onDelete} className="self-start">
          <Trash2 aria-hidden className="size-4" />
          {FILTER_TEXT.deleteFilter}
        </Button>
      )}
    </div>
  );
}

function GroupEditor({
  group,
  depth,
  editing,
}: {
  group: FilterGroup;
  /** The top group is layer 1. */
  depth: number;
  editing: Editing;
}) {
  const { root, properties, save } = editing;
  const first = properties[0];
  const room = hasRoom(root);
  const nested = depth > 1;
  return (
    <div
      role="group"
      aria-label={nested ? FILTER_TEXT.filterGroup : FILTER_TEXT.advancedFilter}
      className={
        nested ? 'flex flex-col gap-2 rounded border border-border p-2' : 'flex flex-col gap-2'
      }
    >
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label={FILTER_TEXT.combinator}
          className="w-auto"
          value={group.combinator}
          onChange={(e) => {
            const combinator: Combinator = e.target.value === 'or' ? 'or' : 'and';
            save(setCombinator(root, group.id, combinator));
          }}
        >
          <option value="and">{FILTER_TEXT.allOf}</option>
          <option value="or">{FILTER_TEXT.anyOf}</option>
        </NativeSelect>
        {nested && (
          <>
            <IconButton
              label={FILTER_TEXT.duplicateGroup}
              size="sm"
              disabled={!hasRoom(root, countConditions(group))}
              onClick={() => save(duplicateNode(root, group.id))}
            >
              <Copy aria-hidden className="size-4" />
            </IconButton>
            <IconButton
              label={FILTER_TEXT.deleteGroup}
              size="sm"
              onClick={() => save(removeNode(root, group.id))}
            >
              <Trash2 aria-hidden className="size-4" />
            </IconButton>
          </>
        )}
      </div>
      {group.children.length === 0 ? (
        <p className="text-small text-muted">{FILTER_TEXT.noRules}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {group.children.map((child) => (
            <li key={child.id}>
              {child.kind === 'group' ? (
                <GroupEditor group={child} depth={depth + 1} editing={editing} />
              ) : (
                <RuleRow rule={child} editing={editing} />
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!first || !room}
          onClick={() => first && save(addRule(root, group.id, first).filter)}
        >
          <Plus aria-hidden className="size-4" />
          {FILTER_TEXT.addRule}
        </Button>
        {canNest(depth) ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={!first || !room}
            onClick={() => first && save(addGroup(root, group.id, first).filter)}
          >
            <Plus aria-hidden className="size-4" />
            {FILTER_TEXT.addGroup}
          </Button>
        ) : (
          <p className="text-label text-muted">{FILTER_TEXT.maxLayers}</p>
        )}
      </div>
    </div>
  );
}

function RuleRow({ rule, editing }: { rule: FilterCondition; editing: Editing }) {
  const { root, all, ctx, save } = editing;
  const prop = all.find((p) => p.id === rule.propertyId);
  return (
    <div role="group" aria-label={ruleText(rule, prop, ctx)} className="flex items-start gap-2">
      <div className="min-w-0 flex-1">
        <RuleFields rule={rule} editing={editing} />
      </div>
      <IconButton
        label={FILTER_TEXT.duplicateRule}
        size="sm"
        disabled={!hasRoom(root)}
        onClick={() => save(duplicateNode(root, rule.id))}
      >
        <Copy aria-hidden className="size-4" />
      </IconButton>
      <IconButton
        label={FILTER_TEXT.deleteRule}
        size="sm"
        onClick={() => save(removeNode(root, rule.id))}
      >
        <Trash2 aria-hidden className="size-4" />
      </IconButton>
    </div>
  );
}
