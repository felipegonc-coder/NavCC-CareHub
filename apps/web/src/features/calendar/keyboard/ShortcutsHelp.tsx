import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Kbd,
} from '@carehub/ui';
import { Fragment } from 'react';

/** One line of the list: its keys (any of them; `+` joins keys pressed together) and what it does. */
interface Row {
  keys: string[];
  does: string;
}

/** The keyboard in the Calendar spec, section 6. */
export const SHORTCUT_GROUPS: readonly { title: string; rows: readonly Row[] }[] = [
  {
    title: 'Single keys',
    rows: [
      { keys: ['T'], does: 'Today' },
      { keys: ['D'], does: 'Day' },
      { keys: ['W'], does: 'Week' },
      { keys: ['M'], does: 'Month' },
      { keys: ['J', '→'], does: 'Next day, week or month' },
      { keys: ['K', '←'], does: 'Previous day, week or month' },
      { keys: ['C'], does: 'New event at the next half hour' },
      { keys: ['Delete'], does: 'Delete the selected event, after you confirm' },
      { keys: ['Esc'], does: 'Close the panel' },
      { keys: ['?'], does: 'Show these shortcuts' },
    ],
  },
  {
    title: 'In the grid',
    rows: [
      { keys: ['Tab'], does: 'Go to the events' },
      { keys: ['←', '→'], does: 'Events on the day before or after' },
      { keys: ['↑', '↓'], does: 'Earlier or later events the same day' },
      { keys: ['Enter'], does: 'Open the event' },
    ],
  },
  {
    title: 'With an event selected',
    rows: [
      { keys: ['Alt+↑', 'Alt+↓'], does: 'Move it 15 minutes earlier or later' },
      { keys: ['Alt+←', 'Alt+→'], does: 'Move it a day earlier or later' },
      { keys: ['Alt+Shift+↑', 'Alt+Shift+↓'], does: 'End it 15 minutes earlier or later' },
      { keys: ['Ctrl+D'], does: 'Duplicate it' },
    ],
  },
];

/** What screen readers say for keys drawn as symbols. */
const SPOKEN: Readonly<Record<string, string>> = {
  '←': 'Left arrow',
  '→': 'Right arrow',
  '↑': 'Up arrow',
  '↓': 'Down arrow',
  '?': 'Question mark',
};

function Key({ name }: { name: string }) {
  const spoken = SPOKEN[name];
  return (
    <Kbd>
      {spoken ? (
        <>
          <span aria-hidden>{name}</span>
          <span className="sr-only">{spoken}</span>
        </>
      ) : (
        name
      )}
    </Kbd>
  );
}

/** One way to press it: keys pressed together, joined with +. */
function Chord({ keys }: { keys: string }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.split('+').map((name, index) => (
        <Fragment key={name}>
          {index > 0 && <span aria-hidden>+</span>}
          <Key name={name} />
        </Fragment>
      ))}
    </span>
  );
}

/** "?" (or Settings → See all shortcuts): every Calendar key, and whether single keys are on. */
export function ShortcutsHelp({
  open,
  onOpenChange,
  on,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Settings → Single-key shortcuts. */
  on: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            {on
              ? 'Single keys work anywhere in Calendar, except while you type in a field.'
              : 'Single-key shortcuts are off. Turn them on in Calendar settings.'}
          </DialogDescription>
        </DialogHeader>
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title} className="flex flex-col gap-2">
            <h3 className="text-small font-semibold">{group.title}</h3>
            <dl className="flex flex-col gap-1.5 text-small">
              {group.rows.map((row) => (
                <div key={row.does} className="flex items-center gap-3">
                  <dt className="flex w-40 shrink-0 flex-wrap items-center gap-1">
                    {row.keys.map((keys, index) => (
                      <Fragment key={keys}>
                        {index > 0 && <span className="text-muted">or</span>}
                        <Chord keys={keys} />
                      </Fragment>
                    ))}
                  </dt>
                  <dd className="text-muted">{row.does}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
