import { linkTarget, type ButtonBlock } from '@carehub/learning';
import { Button } from '@carehub/ui';
import type { MouseEvent } from 'react';
import type { BlockViewProps } from '../registry';

/** True when the person asked for a new tab or window (Ctrl, Cmd, Shift or the middle button). */
const wantsNewTab = (event: MouseEvent) =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

/**
 * A button block: its description, then a link that looks like a button, to a web page, a Care Hub page, a file
 * or a lesson. Lessons and pages open inside Care Hub; web pages and files open in a new tab. A button whose
 * lesson is gone is shown turned off, with the reason.
 */
export function ButtonView({ block, course, go }: BlockViewProps<ButtonBlock>) {
  const target = linkTarget(course, block.target);
  const newTab = target.kind === 'file' || (target.kind === 'external' && target.newTab);
  return (
    <div className="flex flex-col items-start gap-3">
      {block.description && <p>{block.description}</p>}
      {target.kind === 'broken' ? (
        <>
          <Button disabled>{block.label}</Button>
          <p className="text-small text-muted">{target.reason}</p>
        </>
      ) : (
        <Button asChild>
          <a
            href={target.href}
            {...(newTab
              ? {
                  target: '_blank',
                  rel: 'noopener noreferrer',
                  'aria-label': `${block.label} (opens in a new tab)`,
                }
              : {})}
            onClick={(event) => {
              const link = block.target;
              if ((link.kind !== 'lesson' && link.kind !== 'page') || wantsNewTab(event)) return;
              event.preventDefault();
              go(link);
            }}
          >
            {block.label}
          </a>
        </Button>
      )}
    </div>
  );
}
