import {
  CLAUDE_CONFIRM_LABEL,
  CLAUDE_CONFIRM_NOTE,
  CLAUDE_FEATURE_LABELS,
  CLAUDE_FEATURE_SENDS,
  CLAUDE_FEATURES,
  type ClaudeFeature,
} from '@carehub/extras/claude';
import {
  CHAT_RETENTION_DAYS,
  claudeSettingsViewSchema,
  MAX_MONTHLY_REQUESTS,
  monthlyLimitSchema,
  type ClaudeSettingsUpdate,
  type ClaudeSettingsView,
  type ClaudeSwitchChange,
} from '@carehub/extras/claude/settings';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
  LoadingState,
  NoAccessState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  VisuallyHidden,
} from '@carehub/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { api, ApiError } from '../../../lib/api';
import { STATUS_KEY } from './StatusSync';

// Settings → Claude, for Admins (Claude features spec, sections 2 and 3.1; docs/extras/claude.md).
// Each change saves on its own and shows "Saved" for 2 seconds (Settings and members spec, States).
// Turning a switch on asks first, and Turn on stays grey until the confirm's checkbox is ticked.

export const SETTINGS_KEY = ['claude', 'settings'] as const;
export const SAVED_MS = 2_000;
export const LIMIT_ERROR = 'Use a whole number from 0 to 1,000,000.';

type Retention = ClaudeSettingsView['chatRetentionDays'];
const UNTIL_DELETED = 'until-deleted';
const RETENTION = [
  { value: UNTIL_DELETED, label: 'Until deleted' },
  ...CHAT_RETENTION_DAYS.map((days) => ({
    value: String(days),
    label: days === 365 ? '1 year' : `${days} days`,
  })),
];
const retentionValue = (days: Retention) => (days === null ? UNTIL_DELETED : String(days));
const retentionDays = (value: string) =>
  (value === UNTIL_DELETED ? null : Number(value)) as Retention;

type FieldKey = ClaudeFeature | 'monthlyRequests' | 'chatRetentionDays';
interface Change {
  key: FieldKey;
  /** Names the field when saving fails. */
  label: string;
  update: ClaudeSettingsUpdate;
}

/** The view with a change that's still saving, so the control moves at once. */
function withChange(view: ClaudeSettingsView, update: ClaudeSettingsUpdate): ClaudeSettingsView {
  return {
    ...view,
    switches: { ...view.switches, ...update.switches },
    chatRetentionDays:
      update.chatRetentionDays === undefined ? view.chatRetentionDays : update.chatRetentionDays,
    usage: {
      ...view.usage,
      monthlyRequests: update.monthlyRequests ?? view.usage.monthlyRequests,
    },
  };
}

/** "October 2026" for "2026-10". */
export function monthName(month: string): string {
  const [year = 0, number = 1] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(year, number - 1, 1),
  );
}

const count = (n: number) => n.toLocaleString('en-US');

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Turned on by Avery Lin on Oct 27, 2026.", or null if nobody ever changed the switch. */
export function changedLine(change: ClaudeSwitchChange, on: boolean): string | null {
  if (!change) return null;
  const who = change.by ?? 'a former member';
  return `Turned ${on ? 'on' : 'off'} by ${who} on ${DAY.format(new Date(change.at))}.`;
}

/** Which field shows "Saved", for 2 seconds after each save. */
function useSaved(): [FieldKey | null, (key: FieldKey) => void] {
  const [saved, setSaved] = useState<{ key: FieldKey; at: number } | null>(null);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(null), SAVED_MS);
    return () => clearTimeout(timer);
  }, [saved]);
  return [saved?.key ?? null, (key) => setSaved({ key, at: Date.now() })];
}

function Row({ saved, children }: { saved: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">{children}</div>
      {saved && (
        <span aria-hidden className="text-small text-muted">
          Saved
        </span>
      )}
    </div>
  );
}

/** The confirm before a switch turns on: what it sends, and the tick that makes Turn on work. */
function TurnOnDialog({
  feature,
  onClose,
  onTurnOn,
}: {
  feature: ClaudeFeature | null;
  onClose: () => void;
  onTurnOn: (feature: ClaudeFeature) => void;
}) {
  return (
    <Dialog
      open={feature !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* A new confirm for each switch, so the tick never carries over. */}
      {feature && <TurnOnConfirm key={feature} feature={feature} onTurnOn={onTurnOn} />}
    </Dialog>
  );
}

function TurnOnConfirm({
  feature,
  onTurnOn,
}: {
  feature: ClaudeFeature;
  onTurnOn: (feature: ClaudeFeature) => void;
}) {
  const [ticked, setTicked] = useState(false);
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{`Turn on ${CLAUDE_FEATURE_LABELS[feature]}?`}</DialogTitle>
        <DialogDescription>{`${CLAUDE_FEATURE_SENDS[feature]} ${CLAUDE_CONFIRM_NOTE}`}</DialogDescription>
      </DialogHeader>
      <Field label={CLAUDE_CONFIRM_LABEL} layout="inline">
        <Checkbox checked={ticked} onCheckedChange={(checked) => setTicked(checked === true)} />
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button disabled={!ticked} onClick={() => onTurnOn(feature)}>
          Turn on
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

/** The monthly limit, saved on Enter or when the box loses focus. */
function MonthlyLimit({
  limit,
  busy,
  error,
  onSave,
}: {
  limit: number;
  busy: boolean;
  error: string | undefined;
  onSave: (limit: number) => void;
}) {
  const [draft, setDraft] = useState(String(limit));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(String(limit));
    setInvalid(false);
  }, [limit]);
  const commit = () => {
    const parsed = monthlyLimitSchema.safeParse(draft.trim() === '' ? Number.NaN : Number(draft));
    setInvalid(!parsed.success);
    if (parsed.success && parsed.data !== limit) onSave(parsed.data);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') commit();
  };
  return (
    <Field
      label="Monthly limit"
      hint="Requests a month for the whole workspace. Use 0 to stop Claude."
      error={invalid ? LIMIT_ERROR : error}
    >
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_MONTHLY_REQUESTS}
        step={1}
        value={draft}
        // Read-only, not disabled, while a change saves, so the box keeps focus.
        readOnly={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className="w-full max-w-40"
      />
    </Field>
  );
}

function SettingsSkeleton() {
  return (
    <LoadingState label="Loading Claude settings" className="gap-4">
      {[0, 1, 2].map((card) => (
        <Skeleton key={card} className="h-24 w-full" />
      ))}
    </LoadingState>
  );
}

export default function ClaudeSettings() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: ({ signal }) =>
      api.get('/api/claude/settings', { schema: claudeSettingsViewSchema, signal }),
    retry: false,
  });
  const [saved, flagSaved] = useSaved();
  const [failed, setFailed] = useState<{ key: FieldKey; message: string } | null>(null);
  const [lostAccess, setLostAccess] = useState(false);
  const [confirming, setConfirming] = useState<ClaudeFeature | null>(null);
  const save = useMutation({
    mutationFn: (change: Change) =>
      api.put('/api/claude/settings', change.update, { schema: claudeSettingsViewSchema }),
    onMutate: () => setFailed(null),
    onSuccess: (view, change) => {
      client.setQueryData(SETTINGS_KEY, view);
      // Open tabs hear of it within 5 seconds anyway; this tab right away.
      void client.invalidateQueries({ queryKey: STATUS_KEY });
      flagSaved(change.key);
    },
    onError: (error, change) => {
      if (error instanceof ApiError && error.status === 403) {
        setLostAccess(true);
        return;
      }
      const why = error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
      setFailed({ key: change.key, message: `Couldn't save "${change.label}". ${why}` });
    },
  });

  const forbidden =
    lostAccess || (settings.error instanceof ApiError && settings.error.status === 403);
  if (forbidden) return <NoAccessState />;
  if (!settings.data) {
    if (!settings.isError) return <SettingsSkeleton />;
    return (
      <ErrorState
        message="Couldn't load the Claude settings."
        onRetry={() => void settings.refetch()}
        retrying={settings.isFetching}
      />
    );
  }

  // While a change saves it shows at once, and the other controls wait for it.
  const busy = save.isPending;
  const view =
    busy && save.variables ? withChange(settings.data, save.variables.update) : settings.data;
  const change = (key: FieldKey, label: string, update: ClaudeSettingsUpdate) =>
    save.mutate({ key, label, update });
  const errorFor = (key: FieldKey) => (failed?.key === key ? failed.message : undefined);
  const { usage } = view;
  const turnOn = (feature: ClaudeFeature) => {
    setConfirming(null);
    change(feature, CLAUDE_FEATURE_LABELS[feature], {
      switches: { [feature]: true },
      confirmed: true,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold">Claude</h2>
        <p className="text-small text-muted">
          Nothing is sent to Claude until the server has a key and an Admin turns a feature on.
          People also need Use Claude in their role. Guests never have it.
        </p>
      </div>
      <VisuallyHidden role="status">{saved ? 'Saved' : (failed?.message ?? '')}</VisuallyHidden>

      <Card className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>Key</CardTitle>
          <CardDescription>
            {view.keySet
              ? `Key set. Model: ${view.model}.`
              : "No key. Add it to the server's settings file, then restart Care Hub."}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>
            {view.keySet
              ? 'Each feature is off until you turn it on. Turning one on asks first.'
              : "Features can't be turned on without the key."}
          </CardDescription>
        </CardHeader>
        {CLAUDE_FEATURES.map((feature) => {
          const on = view.switches[feature];
          const changed = changedLine(view.lastChanged[feature], on);
          return (
            <Row key={feature} saved={saved === feature}>
              <Field
                label={CLAUDE_FEATURE_LABELS[feature]}
                hint={
                  changed
                    ? `${CLAUDE_FEATURE_SENDS[feature]} ${changed}`
                    : CLAUDE_FEATURE_SENDS[feature]
                }
                error={errorFor(feature)}
                layout="inline"
              >
                <Switch
                  checked={on}
                  // Off always works; on needs the key, then the confirm.
                  disabled={busy || (!on && !view.keySet)}
                  onCheckedChange={(next) => {
                    if (next) setConfirming(feature);
                    else
                      change(feature, CLAUDE_FEATURE_LABELS[feature], {
                        switches: { [feature]: false },
                      });
                  }}
                />
              </Field>
            </Row>
          );
        })}
      </Card>
      <TurnOnDialog feature={confirming} onClose={() => setConfirming(null)} onTurnOn={turnOn} />

      <Card className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>This month</CardTitle>
          <CardDescription>
            {`${count(usage.requests)} of ${count(usage.monthlyRequests)} requests used in ${monthName(usage.month)}. At the limit, Claude stops until the 1st of next month, or until the limit is raised.`}
          </CardDescription>
        </CardHeader>
        <Row saved={saved === 'monthlyRequests'}>
          <MonthlyLimit
            limit={usage.monthlyRequests}
            busy={busy}
            error={errorFor('monthlyRequests')}
            onSave={(limit) =>
              change('monthlyRequests', 'Monthly limit', { monthlyRequests: limit })
            }
          />
        </Row>
        <ul className="flex flex-col gap-1 text-small">
          {CLAUDE_FEATURES.map((feature) => (
            <li key={feature} className="flex justify-between gap-3">
              <span>{CLAUDE_FEATURE_LABELS[feature]}</span>
              <span className="text-muted">{count(usage.byFeature[feature])}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>Assistant chats</CardTitle>
        </CardHeader>
        <Row saved={saved === 'chatRetentionDays'}>
          <Field
            label="Keep chats"
            hint="How long assistant chats are kept before they're deleted."
            error={errorFor('chatRetentionDays')}
          >
            <Select
              value={retentionValue(view.chatRetentionDays)}
              disabled={busy}
              onValueChange={(value) =>
                change('chatRetentionDays', 'Keep chats', {
                  chatRetentionDays: retentionDays(value),
                })
              }
            >
              <SelectTrigger className="w-full max-w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTION.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </Row>
      </Card>
    </div>
  );
}
