/**
 * The Filter and Sort panels in the design kit's popover, opened from the toolbar's buttons and
 * the filter chips. The shell mounts <ViewPanels> once and passes what the toolbar asked for.
 */
import type { Id } from '@carehub/databases';
import { Popover, PopoverAnchor, PopoverContent } from '@carehub/ui';
import { useMemo, useRef } from 'react';
import { FilterPanel } from './filter-panel';
import { PANEL_TEXT } from './messages';
import { SortPanel } from './sort-panel';
import type { PanelProps } from './types';

export type PanelName = 'filter' | 'sort';

/** What the toolbar asks for (its onOpenFilters). */
export interface PanelRequest {
  panel: PanelName;
  /** The button or chip the panel opens from; focus goes back to it on close. */
  anchor: HTMLElement;
  /** A filter chip: open on its rule. */
  ruleId?: Id | undefined;
  /** The "Advanced filter" chip. */
  advanced?: boolean | undefined;
}

export interface ViewPanelsProps extends PanelProps {
  /** null: no panel open. */
  request: PanelRequest | null;
  onClose(): void;
}

interface Measurable {
  getBoundingClientRect(): DOMRect;
  contextElement?: Element | undefined;
}

export function ViewPanels({ request, onClose, ...props }: ViewPanelsProps) {
  const anchor = useRef<HTMLElement | null>(null);
  if (request) anchor.current = request.anchor;
  // The popover follows whichever button or chip asked for it.
  const virtual = useMemo(() => {
    const measurable: Measurable = {
      getBoundingClientRect: () => (anchor.current ?? document.body).getBoundingClientRect(),
      get contextElement() {
        return anchor.current ?? undefined;
      },
    };
    return { current: measurable };
  }, []);
  const label = request?.panel === 'sort' ? PANEL_TEXT.sorts : PANEL_TEXT.filters;
  return (
    <Popover
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverAnchor virtualRef={virtual} />
      {request && (
        <PopoverContent
          align="start"
          aria-label={label}
          className={request.panel === 'filter' ? 'w-auto min-w-80 max-w-dialog' : 'w-96'}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (anchor.current?.isConnected) anchor.current.focus();
          }}
        >
          {request.panel === 'filter' ? (
            <FilterPanel
              key={`${request.ruleId ?? ''}:${request.advanced ? 'advanced' : ''}`}
              {...props}
              ruleId={request.ruleId}
              advanced={request.advanced}
              onClose={onClose}
            />
          ) : (
            <SortPanel {...props} />
          )}
        </PopoverContent>
      )}
    </Popover>
  );
}
