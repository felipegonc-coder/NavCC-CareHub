import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  LoadingState,
  Textarea,
  useFieldControlProps,
  useToast,
} from '@carehub/ui';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type { ReminderTime } from './api';
import {
  customAllDay,
  customAt,
  customBefore,
  newReminder,
  remindMeChoices,
  type RemindMeTarget,
} from './choices';
import { formatWhen, sentence, toInputs, type BeforeUnit, type TimeSettings } from './format';
import { useCreateReminder, useLoadedTimePrefs } from './hooks';

const NOTE_MAX = 280;
const HOUR_MS = 3_600_000;

interface Props {
  /** Null: there's nothing here to remind about, so it says where Remind me is. */
  target: RemindMeTarget | null;
  onClose: () => void;
  /** Where focus goes when the dialog closes. */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Remind me: a menu of preset times (arrow keys and Enter) or a custom time, and an optional note.
 * On a phone it's a bottom sheet, and the date and time fields open the phone's own pickers.
 */
export function RemindMeDialog({ target, onClose, onCloseAutoFocus }: Props) {
  const prefs = useLoadedTimePrefs();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Remind me</DialogTitle>
          <DialogDescription>{target ? titleOf(target) : NOTHING_HERE}</DialogDescription>
        </DialogHeader>
        {/* Preset times wait for the person's time zone (HR-13). */}
        {target &&
          (prefs ? (
            <Picker target={target} prefs={prefs} onDone={onClose} />
          ) : (
            <LoadingState label="Loading your time settings" />
          ))}
      </DialogContent>
    </Dialog>
  );
}

const NOTHING_HERE = "Open a page first, or use Remind me in an event's panel.";

function titleOf(target: RemindMeTarget): string {
  if (target.title === undefined) return 'This page';
  return target.title.trim() || (target.type === 'page' ? 'Untitled' : '(No title)');
}

interface PickerProps {
  target: RemindMeTarget;
  prefs: TimeSettings;
  onDone: () => void;
}

function Picker({ target, prefs, onDone }: PickerProps) {
  const [openedAt] = useState(() => new Date());
  const [step, setStep] = useState<'menu' | 'custom' | 'back'>('menu');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const create = useCreateReminder();
  const { toast } = useToast();
  const choices = remindMeChoices(target, prefs, openedAt);

  function set(time: ReminderTime) {
    if (create.isPending) return;
    setProblem(null);
    create.mutate(newReminder(target, time, note), {
      onSuccess: (reminder) => {
        const when = sentence(formatWhen(reminder.dueAt, prefs));
        toast({ title: 'Reminder set', description: when, variant: 'success' });
        onDone();
      },
      onError: (error) => setProblem(error.message),
    });
  }

  function go(next: 'custom' | 'back') {
    setProblem(null);
    setStep(next);
  }

  const details = (
    <>
      <Field label="Note" hint={`${note.length} of ${NOTE_MAX} characters`}>
        <Textarea
          rows={2}
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
      {problem && (
        <p role="alert" className="text-small text-danger">
          {problem}
        </p>
      )}
    </>
  );

  if (step === 'custom') {
    return (
      <CustomTime
        target={target}
        prefs={prefs}
        pending={create.isPending}
        onBack={() => go('back')}
        onSet={set}
        onProblem={setProblem}
      >
        {details}
      </CustomTime>
    );
  }
  const custom = {
    id: 'custom',
    label: target.type === 'page' ? 'Custom date and time…' : 'Custom…',
  };
  return (
    <div className="flex flex-col gap-4">
      <ChoiceMenu
        items={[...choices, custom]}
        focusIndex={step === 'back' ? choices.length : 0}
        disabled={create.isPending}
        onPick={(id) => {
          const choice = choices.find((each) => each.id === id);
          if (choice) set(choice.time);
          else go('custom');
        }}
      />
      {details}
    </div>
  );
}

interface MenuProps {
  items: { id: string; label: string }[];
  /** The item that has focus when the menu appears. */
  focusIndex: number;
  disabled: boolean;
  onPick: (id: string) => void;
}

/** One Tab stop: the arrow keys, Home and End move between the items, and Enter picks one. */
function ChoiceMenu({ items, focusIndex, disabled, onPick }: MenuProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(focusIndex);

  useEffect(() => {
    refs.current[focusIndex]?.focus();
  }, [focusIndex]);

  function move(event: KeyboardEvent<HTMLButtonElement>) {
    const last = items.length - 1;
    const keys: Record<string, number> = {
      ArrowDown: active < last ? active + 1 : 0,
      ArrowUp: active > 0 ? active - 1 : last,
      Home: 0,
      End: last,
    };
    const to = keys[event.key];
    if (to === undefined) return;
    event.preventDefault();
    refs.current[to]?.focus();
  }

  return (
    <div role="menu" aria-label="Remind me" className="flex flex-col">
      {items.map((item, index) => (
        <button
          key={item.id}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          role="menuitem"
          tabIndex={index === active ? 0 : -1}
          aria-disabled={disabled || undefined}
          onFocus={() => setActive(index)}
          onKeyDown={move}
          onClick={() => !disabled && onPick(item.id)}
          className="flex w-full items-center rounded px-2 py-1.5 text-left text-small text-fg hover:bg-fill-hover focus:bg-fill-hover focus-visible:outline-offset-inset aria-disabled:text-faint max-md:min-h-11"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

interface CustomProps {
  target: RemindMeTarget;
  prefs: TimeSettings;
  pending: boolean;
  onBack: () => void;
  onSet: (time: ReminderTime) => void;
  onProblem: (problem: string) => void;
  /** The note and any problem, above the buttons. */
  children: ReactNode;
}

/** A typed time: a date and time for a page, or how long before an event. */
function CustomTime({ target, prefs, pending, onBack, onSet, onProblem, children }: CustomProps) {
  // Pages start at the next full hour; all-day events at 9:00 AM the day before.
  const [initial] = useState(() => toInputs(new Date(Date.now() + HOUR_MS), prefs.timeZone));
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(
    target.type === 'page' ? `${initial.time.slice(0, 2)}:00` : '09:00',
  );
  const [amount, setAmount] = useState(target.type === 'event' && target.allDay ? '1' : '15');
  const [unit, setUnit] = useState<BeforeUnit>('minutes');
  const first = useRef<HTMLInputElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const now = new Date();
    const result =
      target.type === 'page'
        ? customAt(date, time, prefs, now)
        : target.allDay
          ? customAllDay(target, amount, time, prefs, now)
          : customBefore(target, amount, unit, prefs, now);
    if ('problem' in result) onProblem(result.problem);
    else onSet(result.time);
  }

  const timeField = (
    <Field label="Time">
      <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
    </Field>
  );
  const number = (label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input
        ref={first}
        type="number"
        inputMode="numeric"
        min={0}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
    </Field>
  );

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        {target.type === 'page' ? (
          <>
            <Field label="Date">
              <Input
                ref={first}
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            {timeField}
          </>
        ) : target.allDay ? (
          <>
            {number('Days before', '0 is the day itself')}
            {timeField}
          </>
        ) : (
          <>
            {number('How long before')}
            <Field label="Unit">
              <UnitSelect value={unit} onChange={setUnit} />
            </Field>
          </>
        )}
      </div>
      {children}
      <DialogFooter>
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button type="submit" loading={pending}>
          Set reminder
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Minutes, hours or days: the phone's own list on a phone. */
function UnitSelect({
  value,
  onChange,
}: {
  value: BeforeUnit;
  onChange: (unit: BeforeUnit) => void;
}) {
  const field = useFieldControlProps({});
  return (
    <select
      {...field}
      value={value}
      onChange={(e) => onChange(e.target.value as BeforeUnit)}
      className="flex h-9 w-full rounded border border-border bg-bg px-3 text-small text-fg hover:border-border-hover max-md:h-11"
    >
      <option value="minutes">minutes</option>
      <option value="hours">hours</option>
      <option value="days">days</option>
    </select>
  );
}
