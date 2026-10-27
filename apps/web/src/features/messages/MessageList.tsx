import { ArrowDown } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@carehub/ui';
import { Row, type RowContext } from './MessageRow';
import type { ListRow } from './rows';

interface MessageListProps {
  rows: ListRow[];
  context: RowContext;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder(): void;
  /** Once true, the list opens at the "New messages" line, or at the newest message. */
  ready: boolean;
  onAtBottomChange(atBottom: boolean): void;
  empty: ReactNode;
}

/** How close to the end still counts as "at the newest message". */
const BOTTOM_SLACK = 48;
/** Older messages load when the person scrolls this close to the top. */
const TOP_SLACK = 200;

export function MessageList({
  rows,
  context,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  ready,
  onAtBottomChange,
  empty,
}: MessageListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const positioned = useRef(false);
  /** The first message on screen before older ones load above it, to keep it in place. */
  const anchor = useRef<{ key: string; offset: number } | null>(null);
  const pendingCount = rows.filter((row) => row.kind === 'pending').length;
  const lastPendingCount = useRef(pendingCount);
  const [showJump, setShowJump] = useState(false);

  const measure = () => {
    const element = scroller.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_SLACK;
    if (bottom !== atBottom.current) {
      atBottom.current = bottom;
      onAtBottomChange(bottom);
    }
    setShowJump(!bottom);
  };

  const loadOlder = () => {
    const element = scroller.current;
    const first = element?.querySelector<HTMLElement>('[data-anchor]');
    if (element && first?.dataset.anchor) {
      anchor.current = { key: first.dataset.anchor, offset: first.offsetTop - element.scrollTop };
    }
    onLoadOlder();
  };

  const onScroll = () => {
    measure();
    const element = scroller.current;
    if (element && element.scrollTop < TOP_SLACK && hasOlder && !loadingOlder) loadOlder();
  };

  const jumpToLatest = () => {
    const element = scroller.current;
    if (element) element.scrollTop = element.scrollHeight;
    measure();
  };

  // After every change: keep the first message in place when older ones arrive, open at the
  // "New messages" line once, and otherwise follow new messages while at the end.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let kept = false;
    const saved = anchor.current;
    if (saved) {
      const nodes = Array.from(element.querySelectorAll<HTMLElement>('[data-anchor]'));
      const node = nodes.find((item) => item.dataset.anchor === saved.key);
      if (!node) anchor.current = null;
      else if (nodes[0] !== node) {
        element.scrollTop = node.offsetTop - saved.offset;
        anchor.current = null;
        kept = true;
      }
    }
    if (!kept) {
      if (ready && !positioned.current) {
        positioned.current = true;
        const line = element.querySelector<HTMLElement>('[data-new-messages]');
        element.scrollTop = line ? line.offsetTop - BOTTOM_SLACK : element.scrollHeight;
      } else if (atBottom.current || pendingCount > lastPendingCount.current) {
        element.scrollTop = element.scrollHeight;
      }
    }
    lastPendingCount.current = pendingCount;
    measure();
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="relative min-h-0 flex-1 overflow-y-auto pb-4"
        data-testid="messages-message-list"
      >
        {hasOlder && (
          <div className="flex justify-center pt-2">
            <Button variant="ghost" size="sm" loading={loadingOlder} onClick={loadOlder}>
              Show earlier messages
            </Button>
          </div>
        )}
        {rows.length === 0 ? (
          empty
        ) : (
          <ol aria-label="Messages" className="flex flex-col">
            {rows.map((row) => (
              <Row key={row.key} row={row} context={context} />
            ))}
          </ol>
        )}
      </div>
      {showJump && (
        <Button
          variant="secondary"
          size="sm"
          className="absolute bottom-4 right-4 shadow-menu"
          onClick={jumpToLatest}
          data-testid="messages-jump-latest"
        >
          <ArrowDown className="size-4" aria-hidden />
          Jump to latest
        </Button>
      )}
    </div>
  );
}
