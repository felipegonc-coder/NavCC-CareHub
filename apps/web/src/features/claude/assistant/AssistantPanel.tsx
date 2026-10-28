// The assistant (Claude features spec, sections 2 and 6): the ✨ button at the bottom right and
// Ctrl+Alt+J (⌘⌥J on a Mac) open and close the panel. Nothing shows while an Admin has the
// Assistant switched off, and switching it off stops a question on its way (CL-05).
import { IconButton, Tooltip } from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useClaudeOn } from '../settings/status';
import { loadViewerId, ME_KEY } from './api';
import {
  closeAssistant,
  isAssistantKey,
  openAssistant,
  panelState,
  setPanelPerson,
  usePanel,
} from './panel-state';
import { Panel } from './Panel';

const onMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function AssistantPanel() {
  const on = useClaudeOn('assistant');
  return on ? <Assistant /> : null;
}

function Assistant() {
  const { open, person } = usePanel();
  const launcher = useRef<HTMLButtonElement>(null);
  /** Where focus goes once the panel has closed: what opened it, or else the ✨ button. */
  const backTo = useRef<HTMLElement | 'launcher' | null>(null);
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: ({ signal }) => loadViewerId(signal),
    staleTime: 0,
  });
  const viewer = me.data ?? null;

  useEffect(() => {
    if (viewer) setPanelPerson(viewer);
  }, [viewer]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (!isAssistantKey(event) || event.repeat) return;
      event.preventDefault();
      if (panelState().open) backTo.current = closeAssistant() ?? 'launcher';
      else openAssistant();
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, []);

  useEffect(() => {
    if (open || !backTo.current) return;
    const target = backTo.current === 'launcher' ? launcher.current : backTo.current;
    backTo.current = null;
    target?.focus();
  }, [open]);

  // Switched off, or signed out: the panel goes, and any question with it.
  useEffect(() => () => void closeAssistant(), []);

  if (!person || person !== viewer) return null;

  if (open) {
    return (
      <Panel
        person={person}
        onClose={() => {
          backTo.current = closeAssistant() ?? 'launcher';
        }}
      />
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-30">
      <Tooltip content={onMac() ? 'Claude (⌘⌥J)' : 'Claude (Ctrl+Alt+J)'} side="left">
        <IconButton
          ref={launcher}
          label="Open Claude"
          variant="primary"
          aria-keyshortcuts="Control+Alt+J"
          className="rounded-full shadow-menu"
          onClick={openAssistant}
        >
          <Sparkles aria-hidden />
        </IconButton>
      </Tooltip>
    </div>
  );
}
