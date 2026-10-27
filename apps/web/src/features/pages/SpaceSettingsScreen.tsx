// Space settings (Sidebar spec, sections 2 and 3.3): name, icon, description, kind, default access,
// who adds top-level pages, the security switches, and archiving or deleting the space. Owners and
// Admins change them; each change saves at once and goes back if the server refuses it.
import {
  Button,
  cn,
  Field,
  IconButton,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Textarea,
  useToast,
  VisuallyHidden,
} from '@carehub/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { changeSpace, fetchSpaceSettings, pagesKeys, SPACE_NAME_MAX } from './api';
import { reasonOf } from './change';
import { IconPicker } from './IconPicker';
import { Problem } from './PageStates';
import { EntryIcon } from './PageTree';
import { ACCESS_LABELS, KindChoices } from './SpaceDialogs';
import { SpaceMembers } from './SpaceMembers';
import { SpaceConfirm, type SpaceAsk } from './SpaceMenu';
import {
  applyChange,
  SECURITY_SWITCHES,
  undoOf,
  type SecuritySwitch,
  type SpaceChange,
  type SpaceSettings,
  type Switches,
  type TopLevel,
} from './space-settings';
import type { SpaceAccess } from './types';

const SWITCHES: Record<SecuritySwitch, { label: string; about: string }> = {
  shareLinks: {
    label: 'Allow share links',
    about: 'Its pages can be shared with anyone who has the link.',
  },
  guests: {
    label: 'Allow guests on its pages',
    about: 'People outside the workspace can be invited to its pages.',
  },
  export: { label: 'Allow export', about: 'Members can export its pages.' },
  moveOut: {
    label: 'Allow moving pages out of the space',
    about: 'Members can move its pages to other spaces.',
  },
};

const TOP_LEVEL_LABELS: Record<TopLevel, string> = {
  members: 'All members',
  owners: 'Owners only',
};

const status = (error: unknown) => (error instanceof ApiError ? error.status : 0);

export function SpaceSettingsScreen() {
  const { spaceId = '' } = useParams();
  const settings = useQuery({
    queryKey: pagesKeys.space(spaceId),
    queryFn: () => fetchSpaceSettings(spaceId),
  });
  const refused = status(settings.error) === 403 || settings.data?.canManage === false;
  if (status(settings.error) === 404 || settings.data === null) {
    return (
      <Problem
        title="This space isn't here"
        text="It may have been archived or deleted, or you may not be in it."
      />
    );
  }
  if (refused) {
    return (
      <Problem
        title="You can't change this space"
        text="Only its owners and Admins can change its settings."
      />
    );
  }
  if (settings.isError) {
    return (
      <Problem title="Couldn't load the space" text="Check your connection, then try again.">
        <Button onClick={() => void settings.refetch()}>Retry</Button>
      </Problem>
    );
  }
  if (!settings.data) return <Loading />;
  return <SettingsForm settings={settings.data} />;
}

/** The settings, each saved once changed. */
function SettingsForm({ settings }: { settings: SpaceSettings }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [asking, setAsking] = useState<SpaceAsk | null>(null);
  const key = pagesKeys.space(settings.id);

  /** Shows the change at once and sends it; resolves to the server's refusal, if any. */
  const save = async (fields: SpaceChange): Promise<unknown> => {
    queryClient.setQueryData<SpaceSettings | null>(key, (now) => now && applyChange(now, fields));
    try {
      await changeSpace(settings.id, fields);
      // The sidebar and Browse spaces show the name and icon too.
      void queryClient.invalidateQueries({ queryKey: pagesKeys.spaces });
      void queryClient.invalidateQueries({ queryKey: pagesKeys.browse });
      return null;
    } catch (error) {
      const undo = undoOf(settings, fields);
      queryClient.setQueryData<SpaceSettings | null>(key, (now) => now && applyChange(now, undo));
      return error;
    }
  };
  /** Saves the change, or says in a toast why it didn't save. */
  const change = (fields: SpaceChange, failed: string) => {
    void save(fields).then((error) => {
      if (error) toast({ title: failed, description: reasonOf(error), variant: 'danger' });
    });
  };
  const setSwitch = (name: SecuritySwitch, on: boolean) => {
    const security: Partial<Switches> = {};
    security[name] = on;
    change({ security }, "Couldn't change the setting.");
  };

  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-8 px-6 py-8 max-md:px-4 max-md:py-4">
      <title>{`Care Hub · ${settings.name} settings`}</title>
      <h1 className="text-title">Space settings</h1>
      <Section title="General">
        <div className="flex items-start gap-2">
          <IconPicker
            icon={settings.icon}
            onChange={(icon) => change({ icon }, "Couldn't change the icon.")}
          >
            <IconButton label="Space icon" variant="secondary" className="mt-6">
              <EntryIcon icon={settings.icon} kind="space" />
            </IconButton>
          </IconPicker>
          <NameField settings={settings} save={save} />
        </div>
        <DescriptionField
          settings={settings}
          onSave={(description) => change({ description }, "Couldn't change the description.")}
        />
      </Section>
      <Section title="Members">
        <SpaceMembers space={settings} />
      </Section>
      <Section title="Access">
        <KindChoices
          value={settings.kind}
          onChange={(kind) => change({ kind }, "Couldn't change who can find it.")}
        />
        <Field
          label="Default access for members"
          hint="On every page in the space, unless a page has its own access."
        >
          <Select
            value={settings.defaultAccess}
            onValueChange={(value) =>
              change({ defaultAccess: value as SpaceAccess }, "Couldn't change the access.")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['full', 'edit', 'comment', 'view'] as const).map((level) => (
                <SelectItem key={level} value={level}>
                  {ACCESS_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Who can add pages at the top level">
          <Select
            value={settings.topLevel}
            onValueChange={(value) =>
              change({ topLevel: value as TopLevel }, "Couldn't change who can add pages.")
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['members', 'owners'] as const).map((who) => (
                <SelectItem key={who} value={who}>
                  {TOP_LEVEL_LABELS[who]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>
      <Section title="Security">
        {SECURITY_SWITCHES.map((name) => {
          const allowed = settings.workspaceAllows[name];
          return (
            <Field
              key={name}
              layout="inline"
              label={SWITCHES[name].label}
              hint={
                allowed
                  ? SWITCHES[name].about
                  : 'Turned off for the whole workspace. An Admin can change that.'
              }
            >
              <Switch
                checked={settings.security[name]}
                disabled={!allowed}
                onCheckedChange={(on: boolean) => setSwitch(name, on)}
              />
            </Field>
          );
        })}
      </Section>
      <Section title="Archive or delete">
        <p className="text-small text-muted">
          Archiving hides the space and makes its pages read-only. Deleting moves it and all its
          pages to Trash.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setAsking('archive')}>
            <Archive aria-hidden />
            Archive space
          </Button>
          <Button variant="danger" onClick={() => setAsking('delete')}>
            <Trash2 aria-hidden />
            Delete space
          </Button>
        </div>
      </Section>
      {asking && (
        <SpaceConfirm
          space={settings}
          asking={asking}
          onClose={() => setAsking(null)}
          onDone={() => void navigate('/')}
        />
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="border-b border-border pb-2 text-h3">
        {title}
      </h2>
      {children}
    </section>
  );
}

interface NameFieldProps {
  settings: SpaceSettings;
  save(change: SpaceChange): Promise<unknown>;
}

/** Saved on Enter or on leaving the field; Escape puts the saved name back. */
function NameField({ settings, save }: NameFieldProps) {
  const [name, setName] = useState(settings.name);
  const [error, setError] = useState<string | null>(null);
  // A name another space has isn't sent again when the field loses focus.
  const taken = useRef<string | null>(null);
  const commit = async () => {
    const clean = name.trim();
    if (!clean) {
      setError('Give the space a name.');
      return;
    }
    setName(clean);
    if (clean === settings.name || clean === taken.current) return;
    const refusal = await save({ name: clean });
    if (status(refusal) === 409) {
      taken.current = clean;
      setError(`There's already a space called “${clean}”.`);
    } else if (refusal) {
      setError(reasonOf(refusal) ?? "Couldn't rename the space. Try again.");
    }
  };
  return (
    <Field label="Name" error={error} required className="flex-1">
      <Input
        value={name}
        maxLength={SPACE_NAME_MAX}
        autoComplete="off"
        onChange={(event) => {
          setName(event.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          } else if (event.key === 'Escape') {
            setName(settings.name);
            setError(null);
          }
        }}
      />
    </Field>
  );
}

interface DescriptionFieldProps {
  settings: SpaceSettings;
  onSave(description: string): void;
}

/** Saved on leaving the field. */
function DescriptionField({ settings, onSave }: DescriptionFieldProps) {
  const [description, setDescription] = useState(settings.description);
  return (
    <Field label="Description" hint="Shown in Browse spaces, so people know what it's for.">
      <Textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => {
          const clean = description.trim();
          setDescription(clean);
          if (clean !== settings.description) onSave(clean);
        }}
      />
    </Field>
  );
}

/** Grey bars, only once loading has taken 300 ms. */
function Loading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!late) return <main />;
  return (
    <main className="mx-auto flex w-full max-w-page flex-col gap-4 px-6 py-8 max-md:px-4">
      <VisuallyHidden role="status">Loading the space&apos;s settings</VisuallyHidden>
      {['w-1/3', 'w-full', 'w-full', 'w-2/3'].map((width, index) => (
        <Skeleton key={index} className={cn(index === 0 ? 'mb-4 h-10' : 'h-9', width)} />
      ))}
    </main>
  );
}
