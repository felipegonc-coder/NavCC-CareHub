// "Claude" in the sidebar (Claude features spec, section 2) opens and closes the assistant. On a
// phone the sidebar is a sheet over the page, so the ✨ button opens the assistant there instead.
import { breakpoints, cn, sidebarRowClasses, useMediaQuery } from '@carehub/ui';
import { Sparkles } from 'lucide-react';
import { useRef } from 'react';
import { closeAssistant, openAssistant, usePanel } from './panel-state';
import { useAssistantOn } from './status';

const DESKTOP = `(min-width: ${breakpoints.md})`;

export function AssistantSidebarEntry() {
  const on = useAssistantOn();
  const desktop = useMediaQuery(DESKTOP);
  const { open, person } = usePanel();
  const button = useRef<HTMLButtonElement>(null);
  if (!on || !desktop || !person) return null;
  return (
    <ul>
      <li>
        <button
          ref={button}
          type="button"
          aria-expanded={open}
          className={cn(sidebarRowClasses({ active: open }), 'w-full')}
          onClick={() => {
            if (!open) {
              openAssistant();
              return;
            }
            (closeAssistant() ?? button.current)?.focus();
          }}
        >
          <Sparkles aria-hidden />
          Claude
        </button>
      </li>
    </ul>
  );
}
