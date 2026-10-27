import {
  isSafeWebLink,
  isValidDateValue,
  numberToDecimal,
  type ChecklistItem,
  type ComputedValue,
  type ConfigOf,
  type FileRef,
  type NumberDisplay,
  type Property,
  type ReadValue,
  type RichText,
  type RichTextSpan,
} from '@carehub/databases';
import { formatComputed, formatValue } from '@carehub/databases/values';
import { buttonClasses, Checkbox, cn, colorClasses, Spinner } from '@carehub/ui';
import { Bell, Check } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CheckMark,
  chipRow,
  FileChip,
  HiddenRowsChip,
  OptionChip,
  PersonChip,
  RowChip,
  textColorClass,
} from './chips';
import { evalContext, numberFill, numberLabel, telHref } from './logic';
import { CELL_TEXT } from './messages';
import type { CellContext, CellViewProps } from './types';

const idList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const isComputed = (v: unknown): v is ComputedValue =>
  typeof v === 'object' && v !== null && 'kind' in v;
const linkCls = 'underline decoration-border underline-offset-2 hover:decoration-fg';

/** How a value shows in a table cell, a card or a row page, for every property type. */
export function CellView({
  property,
  value,
  computed,
  ctx,
  wrap = false,
  onToggle,
  onPress,
  pressBlockedReason,
  hiddenLinks = 0,
  className,
}: CellViewProps) {
  const c = property.config;
  const text = formatValue(property, value as ReadValue, evalContext(ctx));
  const textCls = cn(
    'min-w-0 text-small text-fg',
    wrap ? 'whitespace-pre-wrap break-words' : 'truncate',
    className,
  );
  const chips = cn(chipRow(wrap), className);
  switch (c.type) {
    case 'title': {
      const empty = typeof value !== 'string' || value === '';
      return <span className={cn(textCls, empty && 'text-muted')}>{text}</span>;
    }
    case 'text':
      return (
        <span className={textCls}>
          <RichTextView rt={Array.isArray(value) ? (value as RichText) : []} ctx={ctx} />
        </span>
      );
    case 'number':
      return typeof value === 'string' ? (
        <NumberView d={value} display={c} text={text} className={textCls} />
      ) : null;
    case 'select':
    case 'status': {
      const option = c.options.find((o) => o.id === value);
      return option ? (
        <span className={chips}>
          <OptionChip option={option} status={c.type === 'status'} />
        </span>
      ) : null;
    }
    case 'multi_select': {
      const options = idList(value).flatMap((id) => c.options.filter((o) => o.id === id));
      return options.length ? (
        <span className={chips}>
          {options.map((o) => (
            <OptionChip key={o.id} option={o} />
          ))}
        </span>
      ) : null;
    }
    case 'date':
    case 'created_time':
    case 'edited_time': {
      if (!text) return null;
      const reminder = isValidDateValue(value) && value.reminder !== undefined;
      return (
        <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
          <span className={textCls}>{text}</span>
          {reminder && (
            <span role="img" aria-label={CELL_TEXT.reminder} className="inline-flex shrink-0">
              <Bell aria-hidden className="size-3.5 text-muted" />
            </span>
          )}
        </span>
      );
    }
    case 'checkbox': {
      const checked = value === true;
      if (!onToggle) return <CheckMark checked={checked} />;
      return (
        <Checkbox
          checked={checked}
          aria-label={property.name}
          onCheckedChange={(next) => onToggle(next === true)}
        />
      );
    }
    case 'url':
      return text ? (
        <a href={text} target="_blank" rel="noreferrer noopener" className={cn(textCls, linkCls)}>
          {text}
        </a>
      ) : null;
    case 'email':
      return text ? (
        <a href={`mailto:${text}`} className={cn(textCls, linkCls)}>
          {text}
        </a>
      ) : null;
    case 'phone':
      return text ? (
        <a href={telHref(text)} className={cn(textCls, linkCls)}>
          {text}
        </a>
      ) : null;
    case 'person':
    case 'created_by':
    case 'edited_by':
      // No Created by or Edited by: an anonymous form response ("Anonymous").
      if (c.type !== 'person' && (value === null || value === undefined)) {
        return <span className={cn(textCls, 'text-muted')}>{text}</span>;
      }
      return <PeopleView ids={idList(value)} ctx={ctx} className={chips} />;
    case 'files':
      return Array.isArray(value) && value.length ? (
        <span className={chips}>
          {(value as FileRef[]).map((f) => (
            <FileChip key={f.id} file={f} ctx={ctx} />
          ))}
        </span>
      ) : null;
    case 'relation':
      return <RelationView ids={idList(value)} hidden={hiddenLinks} ctx={ctx} className={chips} />;
    case 'checklist':
      return Array.isArray(value) && value.length ? (
        <ChecklistView items={value as ChecklistItem[]} text={text} />
      ) : null;
    case 'formula':
    case 'rollup': {
      const result = computed ?? (isComputed(value) ? value : { kind: 'empty' as const });
      return <ComputedView value={result} display={c.number} ctx={ctx} className={textCls} />;
    }
    case 'unique_id':
      return text ? <span className={textCls}>{text}</span> : null;
    case 'button':
      return (
        <ButtonCell
          property={property}
          config={c}
          onPress={onPress}
          blockedReason={pressBlockedReason}
        />
      );
  }
}

function RichSpan({ span, ctx }: { span: RichTextSpan; ctx: CellContext }) {
  const mention = span.mention;
  let node: ReactNode =
    mention?.kind === 'user'
      ? `@${ctx.userName(mention.id) ?? span.text.replace(/^@/, '')}`
      : span.text;
  const marks = span.marks ?? [];
  if (marks.includes('code')) node = <code className="rounded-sm bg-fill-hover px-1">{node}</code>;
  if (marks.includes('strike')) node = <s>{node}</s>;
  if (marks.includes('underline')) node = <u>{node}</u>;
  if (marks.includes('italic')) node = <em>{node}</em>;
  if (marks.includes('bold')) node = <strong className="font-semibold">{node}</strong>;
  const color = span.color ? textColorClass(span.color) : undefined;
  if (span.link && isSafeWebLink(span.link)) {
    return (
      <a href={span.link} target="_blank" rel="noreferrer noopener" className={cn(linkCls, color)}>
        {node}
      </a>
    );
  }
  if (!color && !mention) return <>{node}</>;
  return <span className={cn(color, mention && 'font-medium')}>{node}</span>;
}

/** Rich text with its marks, colours, links and mentions. */
export function RichTextView({ rt, ctx }: { rt: RichText; ctx: CellContext }) {
  return (
    <>
      {rt.map((span, i) => (
        <RichSpan key={i} span={span} ctx={ctx} />
      ))}
    </>
  );
}

function Bar({ fill, className }: { fill: number; className: string }) {
  return (
    <span
      aria-hidden
      className="relative h-1 min-w-8 flex-1 overflow-hidden rounded-full bg-border"
    >
      <span
        className={cn('absolute inset-y-0 left-0 rounded-full bg-current', className)}
        style={{ width: `${fill * 100}%` }}
      />
    </span>
  );
}

const RING_RADIUS = 7;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function Ring({ fill, className }: { fill: number; className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className={cn('size-4 shrink-0 -rotate-90', className)}>
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="3"
        className="stroke-border"
      />
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="3"
        stroke="currentColor"
        strokeDasharray={`${fill * RING_LENGTH} ${RING_LENGTH}`}
      />
    </svg>
  );
}

/** A number, or a bar or ring filled to value ÷ divide by ("7 of 10" for screen readers). */
function NumberView({
  d,
  display,
  text,
  className,
}: {
  d: string;
  display: NumberDisplay;
  text: string;
  className: string;
}) {
  if (display.showAs === 'number') return <span className={className}>{text}</span>;
  const fill = numberFill(d, display);
  const color = (colorClasses[display.color] ?? colorClasses.default).text;
  return (
    <span
      role="img"
      aria-label={numberLabel(text, display)}
      data-fill={fill}
      className="flex w-full min-w-0 items-center gap-2"
    >
      {display.showNumber && <span className="shrink-0 text-small text-fg">{text}</span>}
      {display.showAs === 'bar' ? (
        <Bar fill={fill} className={color} />
      ) : (
        <Ring fill={fill} className={color} />
      )}
    </span>
  );
}

function PeopleView({
  ids,
  ctx,
  className,
}: {
  ids: string[];
  ctx: CellContext;
  className: string;
}) {
  const people = ids.flatMap((id) => {
    const name = ctx.userName(id);
    return name === undefined ? [] : [{ id, name }];
  });
  if (!people.length) return null;
  return (
    <span className={className}>
      {people.map((p) => (
        <PersonChip key={p.id} id={p.id} name={p.name} ctx={ctx} />
      ))}
    </span>
  );
}

/** Related rows by title; ones the viewer can't open are counted ("1 row you can't open"). */
function RelationView({
  ids,
  hidden: alsoHidden,
  ctx,
  className,
}: {
  ids: string[];
  hidden: number;
  ctx: CellContext;
  className: string;
}) {
  const rows: { id: string; title: string }[] = [];
  let hidden = alsoHidden;
  for (const id of ids) {
    const title = ctx.rowTitle?.(id);
    if (title === undefined) hidden++;
    else rows.push({ id, title });
  }
  if (!rows.length && !hidden) return null;
  return (
    <span className={className}>
      {rows.map((r) => (
        <RowChip key={r.id} id={r.id} title={r.title} ctx={ctx} />
      ))}
      {hidden > 0 && <HiddenRowsChip count={hidden} />}
    </span>
  );
}

/** "3/5" and a thin bar. */
function ChecklistView({ items, text }: { items: ChecklistItem[]; text: string }) {
  const done = items.filter((i) => i.done).length;
  return (
    <span className="flex w-full min-w-0 items-center gap-2 text-small text-fg">
      <span className="shrink-0">{text}</span>
      <Bar fill={done / items.length} className="text-success" />
    </span>
  );
}

/** A formula's or rollup's result; a broken formula shows "⚠ Formula error". */
function ComputedView({
  value,
  display,
  ctx,
  className,
}: {
  value: ComputedValue;
  display: NumberDisplay | null;
  ctx: CellContext;
  className: string;
}) {
  if (value.kind === 'error') {
    const shown = value.message.startsWith('⚠') ? value.message : CELL_TEXT.formulaError;
    return (
      <span
        className={cn(className, 'text-danger')}
        title={shown === value.message ? undefined : value.message}
      >
        {shown}
      </span>
    );
  }
  if (value.kind === 'boolean') return <CheckMark checked={value.value} />;
  if (value.kind === 'text' && value.rich) {
    return (
      <span className={className}>
        <RichTextView rt={value.rich} ctx={ctx} />
      </span>
    );
  }
  const text = formatComputed(value, display, evalContext(ctx));
  if (value.kind === 'number' && display && display.showAs !== 'number') {
    const d = numberToDecimal(value.value);
    if (d !== null) return <NumberView d={d} display={display} text={text} className={className} />;
  }
  return text ? <span className={className}>{text}</span> : null;
}

const DONE_MS = 2_000;

/**
 * A Button property: a real button (Tab reaches it, Enter or Space presses it). Greyed out with the
 * reason on hover when it can't be pressed, and "Add an action" when it has no actions. A spinner
 * while it runs (more presses are ignored), then a ✓ for 2 seconds. "Done · Undo" is the caller's.
 */
function ButtonCell({
  property,
  config,
  onPress,
  blockedReason,
}: {
  property: Property;
  config: ConfigOf<'button'>;
  onPress: (() => unknown) | undefined;
  blockedReason: string | undefined;
}) {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (state !== 'done') return;
    const timer = setTimeout(() => setState('idle'), DONE_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const reason = !onPress
    ? (blockedReason ?? CELL_TEXT.pressBlocked)
    : config.actions.length === 0
      ? CELL_TEXT.addAction
      : undefined;
  const press = async () => {
    if (!onPress || reason || state === 'running') return;
    setState('running');
    try {
      await onPress();
      if (alive.current) setState('done');
    } catch {
      if (alive.current) setState('idle');
    }
  };
  const color = config.color && config.color !== 'default' ? colorClasses[config.color] : null;
  const emoji = config.icon && !/^[\w-]+$/.test(config.icon) ? config.icon : null;
  return (
    <span className="inline-flex min-w-0 items-center">
      <button
        type="button"
        aria-disabled={reason ? true : undefined}
        aria-busy={state === 'running' || undefined}
        title={reason}
        onClick={() => void press()}
        className={cn(
          buttonClasses({ variant: 'secondary', size: 'sm' }),
          'h-6 max-w-full px-2',
          color?.bg,
          color?.text,
          color && 'border-transparent',
          reason && 'cursor-not-allowed text-faint hover:bg-bg',
        )}
      >
        {state === 'running' ? (
          <Spinner decorative />
        ) : state === 'done' ? (
          <Check aria-hidden />
        ) : (
          emoji && <span aria-hidden>{emoji}</span>
        )}
        <span className="truncate">{config.label.trim() || property.name}</span>
      </button>
      <span role="status" className="sr-only">
        {state === 'running' ? CELL_TEXT.running : state === 'done' ? CELL_TEXT.done : ''}
      </span>
    </span>
  );
}
