import type { TemplateCard } from '@carehub/extras/templates/gallery';
import { updateTemplateSchema, type TemplateSpace } from '@carehub/extras/templates/schemas';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  useToast,
} from '@carehub/ui';
import { Ellipsis } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useDeleteTemplate, useSetHidden, useUpdateTemplate } from './api';
import {
  AudienceField,
  audienceChoices,
  audienceFrom,
  audienceValue,
  CategoryField,
  failureMessage,
  NameFields,
} from './template-fields';

type Change = 'rename' | 'category' | 'audience';

const TITLES: Record<Change, string> = {
  rename: 'Rename template',
  category: 'Change category',
  audience: 'Who can use it',
};

/** Rename (with the description), Change category or Who can use it, one at a time. */
function ChangeDialog({
  card,
  change,
  spaces,
  categories,
  onClose,
}: {
  card: TemplateCard;
  change: Change;
  spaces: readonly TemplateSpace[];
  categories: readonly string[];
  onClose(): void;
}) {
  const update = useUpdateTemplate();
  const { toast } = useToast();
  const [name, setName] = useState(card.name);
  const [description, setDescription] = useState(card.description);
  const [category, setCategory] = useState(card.category);
  const [audience, setAudience] = useState(audienceValue(card.audience));
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input =
      change === 'rename'
        ? { name, description }
        : change === 'category'
          ? { category }
          : { audience: audienceFrom(audience) };
    const parsed = updateTemplateSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    setError(null);
    update.mutate(
      { id: card.id, input: parsed.data },
      {
        onSuccess: (saved) => {
          toast({
            title: `Changed ${saved.name}`,
            description: 'Pages made from it stay as they are.',
          });
          onClose();
        },
        onError: (failure) => setError(failureMessage(failure, 'Couldn’t change the template.')),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{TITLES[change]}</DialogTitle>
            <DialogDescription>{card.name}</DialogDescription>
          </DialogHeader>
          {change === 'rename' && (
            <NameFields
              name={name}
              description={description}
              onName={setName}
              onDescription={setDescription}
            />
          )}
          {change === 'category' && (
            <CategoryField value={category} categories={categories} onChange={setCategory} />
          )}
          {change === 'audience' && (
            <AudienceField
              value={audience}
              choices={audienceChoices(spaces, card.audience)}
              onChange={setAudience}
            />
          )}
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ card, onClose }: { card: TemplateCard; onClose(): void }) {
  const remove = useDeleteTemplate();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const confirm = () =>
    remove.mutate(card.id, {
      onSuccess: () => {
        toast({ title: `Deleted ${card.name}` });
        onClose();
      },
      onError: (failure) => setError(failureMessage(failure, 'Couldn’t delete the template.')),
    });
  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {card.name}?</DialogTitle>
          <DialogDescription>
            It leaves the gallery for everyone. Pages made from it stay as they are.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={remove.isPending} onClick={confirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A card's "…" menu for people who may change the template (spec 2 and 3.1): Rename, Change
 * category, Who can use it and Delete on workspace templates; Hide for everyone (or Show for
 * everyone) on starters, for Admins.
 */
export function TemplateCardMenu({
  card,
  spaces,
  categories,
}: {
  card: TemplateCard;
  spaces: readonly TemplateSpace[];
  categories: readonly string[];
}) {
  const [open, setOpen] = useState<Change | 'delete' | null>(null);
  const hide = useSetHidden();
  const { toast } = useToast();
  const close = () => setOpen(null);

  const toggleHidden = () =>
    hide.mutate(
      { id: card.id, hidden: !card.hidden },
      {
        onSuccess: () =>
          toast({
            title: card.hidden ? `${card.name} shows for everyone` : `${card.name} is hidden`,
            description: card.hidden ? undefined : 'Only Admins see it now, marked Hidden.',
          }),
        onError: (failure) =>
          toast({
            title: failureMessage(failure, 'Couldn’t change the template.'),
            variant: 'danger',
          }),
      },
    );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton label={`More actions for ${card.name}`} size="sm">
            <Ellipsis aria-hidden />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {card.kind === 'starter' ? (
            <DropdownMenuItem onSelect={toggleHidden}>
              {card.hidden ? 'Show for everyone' : 'Hide for everyone'}
            </DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuItem onSelect={() => setOpen('rename')}>Rename</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpen('category')}>
                Change category
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setOpen('audience')}>
                Who can use it
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="danger" onSelect={() => setOpen('delete')}>
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {open === 'delete' && <DeleteDialog card={card} onClose={close} />}
      {open && open !== 'delete' && (
        <ChangeDialog
          card={card}
          change={open}
          spaces={spaces}
          categories={categories}
          onClose={close}
        />
      )}
    </>
  );
}
