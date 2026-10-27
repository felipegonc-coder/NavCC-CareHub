import { linkConnectSchema } from '@carehub/team-calendar-api';
import {
  Button,
  cn,
  colorClasses,
  colorNames,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  type ColorName,
} from '@carehub/ui';
import { useState, type FormEvent } from 'react';
import { useAddLink } from './data';

/** Calendar colours to pick from: the design kit's, without the plain default. */
const COLORS = colorNames.filter((name) => name !== 'default');
const FIRST_COLOR: ColorName = 'blue';
const colorLabel = (name: ColorName) => name[0]?.toUpperCase() + name.slice(1);

type Problems = { url?: string; label?: string; form?: string };

type LinkDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Adds a calendar by its private link (https:// or webcal://), with a name and a colour. */
export function LinkDialog({ open, onOpenChange }: LinkDialogProps) {
  const add = useAddLink();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<ColorName>(FIRST_COLOR);
  const [problems, setProblems] = useState<Problems>({});

  function change(next: boolean) {
    if (!next) {
      setUrl('');
      setLabel('');
      setColor(FIRST_COLOR);
      setProblems({});
      add.reset();
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = linkConnectSchema.safeParse({ url, label, color });
    if (!parsed.success) {
      const found: Problems = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === 'url' || field === 'label') && !found[field]) found[field] = issue.message;
      }
      setProblems(found);
      return;
    }
    setProblems({});
    add.mutate(parsed.data, {
      onSuccess: () => change(false),
      onError: (error) => setProblems({ form: error.message }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add a calendar link</DialogTitle>
            <DialogDescription>
              Paste the private address of a calendar, from its sharing settings. Care Hub checks it
              for changes every 15 minutes and keeps the link to itself.
            </DialogDescription>
          </DialogHeader>
          <Field label="Name" error={problems.label} required>
            <Input
              value={label}
              maxLength={100}
              placeholder="School"
              onChange={(event: { target: HTMLInputElement }) => setLabel(event.target.value)}
            />
          </Field>
          <Field
            label="Link"
            hint="It starts with https:// or webcal://."
            error={problems.url}
            required
          >
            <Input
              value={url}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="webcal://calendar.example.com/school.ics"
              onChange={(event: { target: HTMLInputElement }) => setUrl(event.target.value)}
            />
          </Field>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-small font-medium">Colour</legend>
            <div className="flex flex-wrap gap-2">
              {COLORS.map((name) => (
                <label
                  key={name}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 text-small',
                    'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary max-md:min-h-11',
                    name === color ? 'border-primary' : 'border-border',
                  )}
                >
                  <input
                    type="radio"
                    name="color"
                    value={name}
                    checked={name === color}
                    onChange={() => setColor(name)}
                    className="sr-only"
                  />
                  <span aria-hidden className={cn('size-3 rounded-full', colorClasses[name].bg)} />
                  {colorLabel(name)}
                </label>
              ))}
            </div>
          </fieldset>
          {problems.form && (
            <p role="alert" className="text-small text-danger">
              {problems.form}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={add.isPending}>
              Add calendar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
