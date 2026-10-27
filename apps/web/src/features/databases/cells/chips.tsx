import type {
  FileRef,
  Id,
  OptionColor,
  SelectOption,
  TextColor,
  VerificationState,
} from '@carehub/databases';
import { hiddenRowsText } from '@carehub/databases/values';
import { Avatar, cn, colorClasses } from '@carehub/ui';
import { BadgeCheck, Check, FileText, Lock, Paperclip } from 'lucide-react';
import type { ReactNode } from 'react';
import { isImageFile } from './logic';
import { CELL_TEXT } from './messages';
import type { CellContext } from './types';

const colors = (color: OptionColor) => colorClasses[color] ?? colorClasses.default;

/** Classes for a text or background colour picked in rich text ("blue", "blue_background"). */
export function textColorClass(color: TextColor): string {
  const [name, background] = color.split('_') as [OptionColor, string | undefined];
  return background ? colors(name).bg : colors(name).text;
}

/** Chips in a row: cut off at the cell's edge, or wrapped onto more lines. */
export const chipRow = (wrap: boolean): string =>
  cn('flex min-w-0 items-center gap-1', wrap ? 'flex-wrap' : 'overflow-hidden');

/** A select, multi-select or status option in its colour. Status options get a dot. */
export function OptionChip({
  option,
  status = false,
  children,
}: {
  option: SelectOption;
  status?: boolean;
  children?: ReactNode;
}) {
  const c = colors(option.color);
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full shrink-0 items-center gap-1 px-1.5 text-small',
        status ? 'rounded-full' : 'rounded',
        c.bg,
        c.text,
      )}
    >
      {status && <span aria-hidden className="size-2 shrink-0 rounded-full bg-current" />}
      <span className="truncate">{option.name}</span>
      {children}
    </span>
  );
}

/** A person with their photo; removed members are grey with "(removed)". */
export function PersonChip({
  id,
  name,
  ctx,
  avatar,
  children,
}: {
  id: Id;
  name: string;
  ctx: CellContext;
  /** A photo already known (from the people list); else ctx.userAvatar. */
  avatar?: string | undefined;
  children?: ReactNode;
}) {
  const removed = ctx.isRemovedUser?.(id) === true;
  return (
    <span
      className={cn(
        'inline-flex min-w-0 shrink-0 items-center gap-1.5 text-small',
        removed ? 'text-muted' : 'text-fg',
      )}
    >
      <Avatar name={name} src={avatar ?? ctx.userAvatar?.(id)} size="sm" decorative />
      <span className="truncate">{removed ? `${name} (removed)` : name}</span>
      {children}
    </span>
  );
}

/** A related row by its title ("Untitled" when it has none); a link when the caller gives one. */
export function RowChip({
  id,
  title,
  icon,
  ctx,
  link = true,
  children,
}: {
  id: Id;
  title: string;
  /** The row page's emoji, when it has one. */
  icon?: string | null | undefined;
  ctx: CellContext;
  link?: boolean;
  children?: ReactNode;
}) {
  const href = link ? ctx.rowHref?.(id) : undefined;
  const content = (
    <>
      {icon ? (
        <span aria-hidden className="shrink-0">
          {icon}
        </span>
      ) : (
        <FileText aria-hidden className="size-3.5 shrink-0 text-muted" />
      )}
      <span className="truncate">{title || CELL_TEXT.untitled}</span>
    </>
  );
  return (
    <span className="inline-flex min-w-0 shrink-0 items-center gap-1 rounded px-1 text-small text-fg">
      {href ? (
        <a
          href={href}
          className="inline-flex min-w-0 items-center gap-1 underline decoration-border underline-offset-2"
        >
          {content}
        </a>
      ) : (
        content
      )}
      {children}
    </span>
  );
}

/** Related rows the viewer can't open: counted, never titled ("1 row you can't open"). */
export function HiddenRowsChip({ count }: { count: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-small text-muted">
      <Lock aria-hidden className="size-3.5" />
      {hiddenRowsText(count)}
    </span>
  );
}

/** A file or web link: pictures show a thumbnail; it opens in a new tab when it has an address. */
export function FileChip({
  file,
  ctx,
  children,
}: {
  file: FileRef;
  ctx: CellContext;
  children?: ReactNode;
}) {
  const href = file.url ?? ctx.fileHref?.(file);
  const cls = 'inline-flex min-w-0 shrink-0 items-center gap-1 rounded bg-fill px-1.5 text-small';
  const content = (
    <>
      {href && isImageFile(file) ? (
        <img src={href} alt="" className="size-5 shrink-0 rounded-sm object-cover" />
      ) : (
        <Paperclip aria-hidden className="size-3.5 shrink-0 text-muted" />
      )}
      <span className="truncate">{file.name}</span>
    </>
  );
  return (
    <span className={cls}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex min-w-0 items-center gap-1 text-fg underline-offset-2 hover:underline"
        >
          {content}
        </a>
      ) : (
        content
      )}
      {children}
    </span>
  );
}

/** A drawn checkbox (no input): "Checked" or "Unchecked" for screen readers. */
export function CheckMark({ checked }: { checked: boolean }) {
  return (
    <span
      role="img"
      aria-label={checked ? CELL_TEXT.checked : CELL_TEXT.unchecked}
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-sm border',
        checked ? 'border-primary bg-primary text-primary-fg' : 'border-muted bg-bg',
      )}
    >
      {checked && <Check aria-hidden strokeWidth={3} className="size-3" />}
    </span>
  );
}

/**
 * A verification: Verified in green with a check, Expired in orange, Not verified in grey text (a
 * state, not an empty cell). `text` says it in full ("Verified by Avery Lin until Jan 20, 2027").
 */
export function VerificationBadge({
  state,
  text,
  wrap = false,
}: {
  state: VerificationState;
  text: string;
  wrap?: boolean;
}) {
  const fit = wrap ? 'break-words' : 'truncate';
  if (state === 'none') {
    return <span className={cn('min-w-0 text-small text-muted', fit)}>{text}</span>;
  }
  const c = colors(state === 'verified' ? 'green' : 'orange');
  return (
    <span
      className={cn(
        'inline-flex min-w-0 max-w-full shrink-0 items-center gap-1 rounded px-1.5 text-small',
        c.bg,
        c.text,
      )}
    >
      {state === 'verified' && <BadgeCheck aria-hidden className="size-3.5 shrink-0" />}
      <span className={cn('min-w-0', fit)}>{text}</span>
    </span>
  );
}
