import { WORKSPACE_CATEGORY } from '@carehub/extras/templates/gallery';
import { saveTemplateSchema } from '@carehub/extras/templates/schemas';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Switch,
  useToast,
} from '@carehub/ui';
import { useState, type FormEvent } from 'react';
import { useGallery, useSaveTemplate } from './api';
import {
  AudienceField,
  audienceChoices,
  audienceFrom,
  CategoryField,
  failureMessage,
  NameFields,
} from './template-fields';

/** The page being saved, as the page menu passes it. */
export interface SavedPage {
  id: string;
  title: string;
}

type Problems = Partial<Record<'name' | 'category', string>>;

/**
 * Save as template (spec 2): name, description, category (pick or type a new one), who can use it
 * (Everyone in the workspace, or Members of a space) and Include sub-pages, on by default.
 */
export function SaveTemplateDialog({ page, onClose }: { page: SavedPage; onClose(): void }) {
  const gallery = useGallery();
  const save = useSaveTemplate();
  const { toast } = useToast();
  const [name, setName] = useState(page.title.trim() || 'Untitled');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [audience, setAudience] = useState('everyone');
  const [includeSubpages, setIncludeSubpages] = useState(true);
  const [problems, setProblems] = useState<Problems>({});
  const [error, setError] = useState<string | null>(null);
  const choices = audienceChoices(gallery.data?.spaces ?? []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = saveTemplateSchema.safeParse({
      pageId: page.id,
      name,
      description,
      category,
      audience: audienceFrom(audience),
      includeSubpages,
    });
    if (!parsed.success) {
      const found: Problems = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if ((field === 'name' || field === 'category') && !found[field]) {
          found[field] = issue.message;
        }
      }
      setProblems(found);
      if (!found.name && !found.category) setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    setProblems({});
    save.mutate(parsed.data, {
      onSuccess: (card) => {
        toast({
          title: `Saved ${card.name} as a template`,
          description: `It’s in the template gallery, under ${WORKSPACE_CATEGORY}.`,
        });
        onClose();
      },
      onError: (failure) => setError(failureMessage(failure, 'Couldn’t save the template.')),
    });
  };

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Save as template</DialogTitle>
            <DialogDescription>
              A copy of this page goes to the template gallery. Changing the page later doesn’t
              change the template.
            </DialogDescription>
          </DialogHeader>
          <NameFields
            name={name}
            description={description}
            onName={setName}
            onDescription={setDescription}
            error={problems.name}
          />
          <CategoryField
            value={category}
            categories={gallery.data?.categories ?? []}
            onChange={setCategory}
            error={problems.category}
          />
          <AudienceField value={audience} choices={choices} onChange={setAudience} />
          <Field label="Include sub-pages" layout="inline">
            <Switch checked={includeSubpages} onCheckedChange={setIncludeSubpages} />
          </Field>
          {error && (
            <p role="alert" className="text-small text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
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
