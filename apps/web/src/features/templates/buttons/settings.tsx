// A button's settings (⚙ Edit button): label, icon, color, who can press it and the steps in
// order, with the plain sentence under them and, for editors, the last runs (spec 2 and 3.4).
// Steps move with Move up and Move down, or by dragging. On a phone it's a full screen.
import type { DatabaseMeta } from '@carehub/databases';
import {
  ACTION_NAMES,
  BUTTON_COLORS,
  BUTTON_LIMITS,
  describeButton,
  type ButtonAction,
  type ButtonActionKind,
  type ButtonColor,
  type ButtonResponse,
  type ButtonRunEntry,
  type ButtonWho,
} from '@carehub/extras/templates/buttons';
import {
  breakpoints,
  Button,
  cn,
  colorClasses,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useMediaQuery,
  VisuallyHidden,
} from '@carehub/ui';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useCallback, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { failureMessage } from '../template-fields';
import { ActionFields, newAction, rowStepBefore } from './action-fields';
import { buttonKeys, useSaveButton } from './api';
import { inEditorMenu } from './blocks-field';
import { finishSettings } from './finish';

const PHONE = `not all and (min-width: ${breakpoints.md})`;

const COLOR_NAMES: Record<ButtonColor, string> = {
  default: 'Default',
  gray: 'Gray',
  brown: 'Brown',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
  red: 'Red',
};

const WHO_NAMES: Record<ButtonWho, string> = {
  editors: 'People who can edit this page',
  viewers: 'Anyone who can view this page',
};

const KINDS = Object.keys(ACTION_NAMES) as ButtonActionKind[];

const RESULTS: Record<ButtonRunEntry['status'], string> = {
  done: 'Done',
  failed: 'Failed',
  refused: 'Not allowed',
  cancelled: 'Cancelled',
  undone: 'Undone',
  paused: 'Waiting for a confirmation',
};

function RunLine({ run }: { run: ButtonRunEntry }) {
  const when = new Date(run.at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const result =
    run.status === 'failed' && run.failedStep
      ? `Failed at step ${run.failedStep}`
      : RESULTS[run.status];
  return (
    <li className="flex flex-wrap gap-x-2 text-small">
      <span className="font-medium">{run.userName}</span>
      <span className="text-muted">{when}</span>
      <span>
        {result}
        {run.reason ? `: ${run.reason}` : ''}
      </span>
    </li>
  );
}

interface StepItemProps {
  id: string;
  index: number;
  count: number;
  name: string;
  onMove(by: -1 | 1): void;
  onRemove(): void;
  children: ReactNode;
}

function StepItem({ id, index, count, name, onMove, onRemove, children }: StepItemProps) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const step = index + 1;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex flex-col gap-3 rounded border border-border bg-bg p-3',
        isDragging && 'relative z-10 shadow-menu',
      )}
    >
      <div className="flex items-center gap-2">
        {/* Dragging is for the mouse and touch; Move up and Move down do the same by keyboard. */}
        <span {...listeners} aria-hidden className="cursor-grab touch-none text-faint">
          <GripVertical className="size-4" />
        </span>
        <h4 className="text-small font-semibold">
          {step}. {name}
        </h4>
        <div className="ml-auto flex items-center">
          <IconButton
            id={`${id}-up`}
            label={`Move step ${step} up`}
            size="sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp aria-hidden />
          </IconButton>
          <IconButton
            id={`${id}-down`}
            label={`Move step ${step} down`}
            size="sm"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown aria-hidden />
          </IconButton>
          <IconButton label={`Remove step ${step}`} size="sm" onClick={onRemove}>
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      </div>
      {children}
    </li>
  );
}

interface Step {
  key: string;
  action: ButtonAction;
}

export interface ButtonSettingsDialogProps {
  button: ButtonResponse;
  onClose(): void;
}

export function ButtonSettingsDialog({ button, onClose }: ButtonSettingsDialogProps) {
  const phone = useMediaQuery(PHONE);
  const queryClient = useQueryClient();
  const save = useSaveButton(button.id, button.pageId);
  const prefix = useId();
  const counter = useRef(0);
  const nextKey = useCallback(() => `${prefix}step${(counter.current += 1)}`, [prefix]);
  const { settings } = button;
  const [label, setLabel] = useState(settings.label);
  const [icon, setIcon] = useState(settings.icon ?? '');
  const [color, setColor] = useState<ButtonColor>(settings.color);
  const [who, setWho] = useState<ButtonWho>(settings.who);
  const [steps, setSteps] = useState<Step[]>(() =>
    settings.actions.map((action) => ({ key: nextKey(), action })),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [said, setSaid] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const actions = steps.map((step) => step.action);
  const sentence = describeButton({ actions });

  const update = useCallback((key: string, action: ButtonAction) => {
    setSteps((all) => all.map((step) => (step.key === key ? { key, action } : step)));
  }, []);

  const move = (index: number, by: -1 | 1) => {
    const to = index + by;
    const step = steps[index];
    if (!step || to < 0 || to >= steps.length) return;
    setSteps(arrayMove(steps, index, to));
    setSaid(`Step ${index + 1} is now step ${to + 1}.`);
    // Keep focus on the step's arrows; at the top or bottom, on the one that still works.
    const edge = to === 0 || to === steps.length - 1;
    const keep = by < 0 ? (edge ? 'down' : 'up') : edge ? 'up' : 'down';
    requestAnimationFrame(() => document.getElementById(`${step.key}-${keep}`)?.focus());
  };

  const remove = (index: number) => {
    setSteps(steps.filter((_, at) => at !== index));
    setSaid(`Step ${index + 1} removed.`);
  };

  const add = (kind: ButtonActionKind) => {
    const rowMade = rowStepBefore(actions, actions.length) !== null;
    setSteps([...steps, { key: nextKey(), action: newAction(kind, rowMade) }]);
    setSaid(`Step ${steps.length + 1}, ${ACTION_NAMES[kind]}, added.`);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The blocks editor's link panel is a form of its own; its submit isn't a Save.
    if (event.target !== event.currentTarget) return;
    const finished = finishSettings({ label, icon, color, who, actions }, (databaseId) =>
      queryClient.getQueryData<DatabaseMeta>(buttonKeys.database(databaseId)),
    );
    if ('problem' in finished) {
      setProblem(finished.problem);
      return;
    }
    setProblem(null);
    save.mutate(finished.settings, {
      onSuccess: () => onClose(),
      onError: (error: unknown) => setProblem(failureMessage(error, 'Couldn’t save the button.')),
    });
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent
        className={cn(
          'md:max-w-page',
          phone && 'm-0 min-h-full max-w-none rounded-none border-0 p-4 pt-12',
        )}
        // Edits are kept: only Cancel, Close or Esc leave. Esc in an editor menu only closes the menu.
        onInteractOutside={(event: Event) => event.preventDefault()}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          if (document.querySelector('body > .ch-slash-menu') || inEditorMenu(event.target)) {
            event.preventDefault();
          }
        }}
      >
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit button</DialogTitle>
            <DialogDescription>
              Pressing it runs the steps in order. If a step can’t be done, the later ones don’t
              run.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-3">
            <Field label="Label" className="min-w-0 flex-1">
              <Input
                value={label}
                maxLength={BUTTON_LIMITS.label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </Field>
            <Field label="Icon" hint="An emoji" className="w-24">
              <Input
                value={icon}
                maxLength={16}
                onChange={(event) => setIcon(event.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <Field label="Color" className="min-w-0 flex-1">
              <Select
                value={color}
                onValueChange={(value: string) => setColor(value as ButtonColor)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUTTON_COLORS.map((name) => (
                    <SelectItem key={name} value={name}>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className={cn(
                            'size-3 rounded-full border border-border',
                            colorClasses[name].bg,
                          )}
                        />
                        {COLOR_NAMES[name]}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Who can press it" className="min-w-0 flex-1">
              <Select value={who} onValueChange={(value: string) => setWho(value as ButtonWho)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(WHO_NAMES) as ButtonWho[]).map((name) => (
                    <SelectItem key={name} value={name}>
                      {WHO_NAMES[name]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <section aria-labelledby={`${prefix}actions`} className="flex flex-col gap-3">
            <h3 id={`${prefix}actions`} className="text-body font-semibold">
              Actions
            </h3>
            {steps.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={({ active, over }: DragEndEvent) => {
                  const from = steps.findIndex((step) => step.key === active.id);
                  const to = steps.findIndex((step) => step.key === over?.id);
                  if (from < 0 || to < 0 || from === to) return;
                  setSteps(arrayMove(steps, from, to));
                  setSaid(`Step ${from + 1} is now step ${to + 1}.`);
                }}
              >
                <SortableContext
                  items={steps.map((step) => step.key)}
                  strategy={verticalListSortingStrategy}
                >
                  <ol className="flex flex-col gap-3">
                    {steps.map((step, index) => (
                      <StepItem
                        key={step.key}
                        id={step.key}
                        index={index}
                        count={steps.length}
                        name={ACTION_NAMES[step.action.kind]}
                        onMove={(by) => move(index, by)}
                        onRemove={() => remove(index)}
                      >
                        <ActionFields
                          action={step.action}
                          index={index}
                          actions={actions}
                          onChange={(action) => update(step.key, action)}
                        />
                      </StepItem>
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  disabled={steps.length >= BUTTON_LIMITS.actions}
                >
                  <Plus aria-hidden />
                  Add action
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {KINDS.map((kind) => (
                  <DropdownMenuItem key={kind} onSelect={() => add(kind)}>
                    {ACTION_NAMES[kind]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <p className="text-small text-muted">
              {sentence || 'Add an action to choose what the button does.'}
            </p>
            <VisuallyHidden role="status">{said}</VisuallyHidden>
          </section>

          {button.runs.length > 0 && (
            <section aria-labelledby={`${prefix}runs`} className="flex flex-col gap-2">
              <h3 id={`${prefix}runs`} className="text-body font-semibold">
                Last runs
              </h3>
              <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {button.runs.map((run) => (
                  <RunLine key={run.id} run={run} />
                ))}
              </ul>
            </section>
          )}

          {problem && (
            <p role="alert" className="text-small text-danger">
              {problem}
            </p>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
