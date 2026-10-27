import { CLAUDE_FEATURE_LABELS, CLAUDE_FEATURES, type ClaudeFeature } from '@carehub/extras/claude';
import {
  CHAT_RETENTION_DAYS,
  claudeSettingsViewSchema,
  type ClaudeSettingsUpdate,
  type ClaudeSettingsView,
} from '@carehub/extras/claude/settings';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  ErrorState,
  Field,
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
import { useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '../../../lib/api';
import { STATUS_KEY } from './StatusSync';

// Settings → Claude, for Admins (Claude features spec, section 3; docs/extras/claude.md). Each
// change saves on its own and shows "Saved" for 2 seconds (Settings and members spec, States).

export const SETTINGS_KEY = ['claude', 'settings'] as const;
export const SAVED_MS = 2_000;

/** What each switch does, under its name. */
export const EXPLAINED: Readonly<Record<ClaudeFeature, string>> = {
  writing_help: 'Ask Claude to rewrite, shorten or continue text while editing a page.',
  assistant: 'A panel where people ask Claude about the pages they can open.',
  fields: 'Database fields that Claude fills in for each row.',
  meeting_summary: "A summary and action items from a meeting's notes.",
  learning_help: 'Help with lessons and quizzes in Learning.',
};

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

type FieldKey = 'navApproved' | ClaudeFeature | 'chatRetentionDays';
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
    navApproved: update.navApproved ?? view.navApproved,
    switches: { ...view.switches, ...update.switches },
    chatRetentionDays:
      update.chatRetentionDays === undefined ? view.chatRetentionDays : update.chatRetentionDays,
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold">Claude</h2>
        <p className="text-small text-muted">
          Nothing is sent to Claude until the server has a key, Nav has given the OK, and a feature
          is switched on. People also need Use Claude in their role. Guests never have it.
        </p>
      </div>
      <VisuallyHidden role="status">{saved ? 'Saved' : (failed?.message ?? '')}</VisuallyHidden>

      <Card className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>Connection</CardTitle>
          <CardDescription>
            {view.keySet
              ? `The server has a Claude key. Model: ${view.model}.`
              : 'The server has no Claude key yet. Whoever runs the server adds ANTHROPIC_API_KEY to its settings file.'}
          </CardDescription>
        </CardHeader>
        <Row saved={saved === 'navApproved'}>
          <Field
            label="Nav has given the OK"
            hint="Tick this once Nav has agreed that page text may be sent to Claude. No feature works without it."
            error={errorFor('navApproved')}
            layout="inline"
          >
            <Checkbox
              checked={view.navApproved}
              disabled={busy}
              onCheckedChange={(checked) =>
                change('navApproved', 'Nav has given the OK', { navApproved: checked === true })
              }
            />
          </Field>
        </Row>
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>Features</CardTitle>
          <CardDescription>
            {view.navApproved
              ? 'Each feature is off until you switch it on.'
              : 'Tick "Nav has given the OK" before switching features on.'}
          </CardDescription>
        </CardHeader>
        {CLAUDE_FEATURES.map((feature) => (
          <Row key={feature} saved={saved === feature}>
            <Field
              label={CLAUDE_FEATURE_LABELS[feature]}
              hint={EXPLAINED[feature]}
              error={errorFor(feature)}
              layout="inline"
            >
              <Switch
                checked={view.switches[feature]}
                disabled={busy || !view.navApproved}
                onCheckedChange={(on) =>
                  change(feature, CLAUDE_FEATURE_LABELS[feature], { switches: { [feature]: on } })
                }
              />
            </Field>
          </Row>
        ))}
      </Card>

      <Card className="flex flex-col gap-4">
        <CardHeader>
          <CardTitle>This month</CardTitle>
          <CardDescription>
            {`${count(usage.requests)} of ${count(usage.monthlyRequests)} requests used in ${monthName(usage.month)}. At the limit, Claude stops until next month.`}
          </CardDescription>
        </CardHeader>
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
