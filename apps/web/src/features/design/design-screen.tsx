import {
  Avatar,
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  IconButton,
  Input,
  Kbd,
  Logo,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeSwitch,
  tokenNames,
  type ButtonVariant,
} from '@carehub/ui';
import { Plus, Settings, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

const variants: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];
const people = ['Sam Rivers', 'Alex Morgan', 'Priya Nandakumar', 'Jo Lee'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6">
      <h2 className="text-label font-medium uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

/** /design: every token and component from @carehub/ui, in the current theme. Fictional data only. */
export function DesignScreen() {
  return (
    <main className="mx-auto flex max-w-page flex-col gap-10 px-6 py-12">
      <title>Care Hub · Design kit</title>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Logo size={40} decorative />
          <div>
            <h1 className="text-title">Design kit</h1>
            <p className="text-muted">Tokens and components from @carehub/ui.</p>
          </div>
        </div>
        <ThemeSwitch />
      </header>

      <Section title="Colours">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tokenNames.map((name) => (
            <li key={name} className="flex items-center gap-2 text-small">
              <span
                aria-hidden
                className="size-6 shrink-0 rounded border border-border"
                style={{ backgroundColor: `rgb(var(--ch-${name}))` }}
              />
              {name}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <p className="text-title">Title, 36 bold</p>
        <p className="text-body">Body, 16. Customer asked about a delivery date for order 1042.</p>
        <p className="text-small text-muted">Small, 14, secondary text.</p>
        <p className="text-label text-muted">Label, 12</p>
      </Section>

      <Section title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant.charAt(0).toUpperCase() + variant.slice(1)}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">
            <Plus aria-hidden />
            New page
          </Button>
          <Button loading>Saving</Button>
          <Button disabled>Disabled</Button>
          <IconButton label="Settings">
            <Settings aria-hidden />
          </IconButton>
          <IconButton label="Move to Trash" variant="secondary">
            <Trash2 aria-hidden />
          </IconButton>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" hint="As customers will see it.">
            <Input placeholder="Sam Rivers" />
          </Field>
          <Field label="Email" error="Enter an email address." required>
            <Input type="email" defaultValue="sam.rivers@" />
          </Field>
          <Field label="Team">
            <Select>
              <SelectTrigger>
                <SelectValue placeholder="Choose a team" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="support">Support</SelectItem>
                <SelectItem value="billing">Billing</SelectItem>
                <SelectItem value="returns">Returns</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Note">
            <Textarea placeholder="Write a short note" />
          </Field>
          <Field label="Email me a copy" layout="inline">
            <Checkbox defaultChecked />
          </Field>
          <Field label="Desktop notifications" layout="inline">
            <Switch />
          </Field>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="details">
          <TabsList aria-label="Ticket">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>
          <TabsContent value="details">Opened by Sam Rivers, waiting for a reply.</TabsContent>
          <TabsContent value="history">Two replies, one internal note.</TabsContent>
        </Tabs>
      </Section>

      <Section title="People, cards and loading">
        <div className="flex items-center gap-2">
          {people.map((name) => (
            <Avatar key={name} name={name} />
          ))}
        </div>
        <Card>
          <CardHeader>
            <CardTitle as="h3">Weekly summary</CardTitle>
            <CardDescription>
              18 conversations closed. Press <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> to search.
            </CardDescription>
          </CardHeader>
        </Card>
        <Separator />
        <div className="flex items-center gap-3">
          <Spinner />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
      </Section>
    </main>
  );
}
