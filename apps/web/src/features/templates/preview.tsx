import {
  describeContents,
  TEMPLATE_MESSAGES,
  type TemplateCard,
} from '@carehub/extras/templates/gallery';
import { outline } from '@carehub/extras/templates/preview';
import type { UseTarget } from '@carehub/extras/templates/schemas';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from '@carehub/ui';
import { Database } from 'lucide-react';
import { useState, type KeyboardEvent } from 'react';
import { usePreview } from './api';
import type { GalleryOrigin } from './links';
import { PreviewPage } from './preview-page';
import { TemplateIconView } from './template-card';

/** One place "Add to:" offers. */
export interface AddToChoice {
  value: string;
  label: string;
  target: UseTarget;
}

/** "Add to:": where the gallery was opened from (the default), or Private. */
export function addToChoices(origin: GalleryOrigin | null, title: string | null): AddToChoice[] {
  const own: AddToChoice = { value: 'private', label: 'Private', target: { type: 'private' } };
  if (!origin) return [own];
  const { pageId } = origin;
  if (origin.mode === 'apply') {
    const label = title ? `This page (${title})` : 'This page';
    return [{ value: 'apply', label, target: { type: 'apply', pageId } }, own];
  }
  const label = title ? `Inside ${title}` : 'Inside the page you came from';
  return [{ value: 'page', label, target: { type: 'page', pageId } }, own];
}

export interface TemplatePreviewProps {
  /** The card being previewed; null keeps the dialog closed. */
  card: TemplateCard | null;
  onClose(): void;
  choices: readonly AddToChoice[];
  /** Phones show the preview full screen. */
  phone: boolean;
  pending: boolean;
  /** Why the last Use template failed, shown in the dialog. */
  error: string | null;
  onUse(target: UseTarget, includeSampleRows: boolean): void;
}

/** The read-only preview: the top page, what comes with it, "Add to:" and Use template. */
export function TemplatePreview({ card, onClose, ...rest }: TemplatePreviewProps) {
  return (
    <Dialog open={card !== null} onOpenChange={(open: boolean) => !open && onClose()}>
      {card && <PreviewContent key={card.id} card={card} {...rest} />}
    </Dialog>
  );
}

function PreviewContent({
  card,
  choices,
  phone,
  pending,
  error,
  onUse,
}: Omit<TemplatePreviewProps, 'onClose'> & { card: TemplateCard }) {
  const preview = usePreview(card.id);
  const [choice, setChoice] = useState(choices[0]?.value ?? 'private');
  const [includeSampleRows, setIncludeSampleRows] = useState(true);
  const template = preview.data?.template ?? card;
  const pages = preview.data?.pages ?? [];
  const target = (choices.find((item) => item.value === choice) ?? choices[0])?.target ?? {
    type: 'private',
  };
  const submit = () => {
    if (!pending) onUse(target, includeSampleRows);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    submit();
  };

  return (
    <DialogContent
      onKeyDown={onKeyDown}
      className={cn(
        'md:max-w-page',
        phone && 'm-0 min-h-full max-w-none rounded-none border-0 p-4 pt-12',
      )}
    >
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <TemplateIconView icon={template.icon} />
          {template.name}
        </DialogTitle>
        <DialogDescription>
          {TEMPLATE_MESSAGES.byLine(template.by)} · {describeContents(template.contents)}
        </DialogDescription>
      </DialogHeader>
      {template.description && <p className="text-body text-muted">{template.description}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        <section
          aria-label="Preview"
          className="rounded border border-border p-4 md:col-span-2 md:max-h-96 md:overflow-y-auto"
        >
          {preview.isPending ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          ) : preview.isError ? (
            <p role="alert" className="text-small text-danger">
              {preview.error?.message ?? 'Couldn’t load the preview.'}
            </p>
          ) : (
            <PreviewPage markdown={preview.data?.markdown ?? ''} />
          )}
        </section>
        {pages.length > 1 && (
          <section aria-label="What comes with it" className="text-small">
            <ul className="flex flex-col gap-1">
              {outline(pages).map(({ page, depth }) => (
                <li
                  key={page.key}
                  className="flex items-center gap-2"
                  style={{ paddingLeft: `calc(var(--ch-space-4) * ${depth})` }}
                >
                  {page.kind === 'database' ? (
                    <Database aria-hidden className="size-4 text-muted" />
                  ) : (
                    <TemplateIconView icon={page.icon} />
                  )}
                  <span className="truncate">
                    {page.title || 'Untitled'}
                    {page.kind === 'database' && <span className="sr-only"> (database)</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <DialogFooter className="flex flex-wrap items-end gap-4">
        {choices.length > 1 ? (
          <Field label="Add to:" className="min-w-56">
            <Select value={choice} onValueChange={setChoice}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {choices.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : (
          <p className="text-small text-muted">Add to: {choices[0]?.label ?? 'Private'}</p>
        )}
        {template.contents.databases > 0 && (
          <Field label="Include sample rows" layout="inline">
            <Switch checked={includeSampleRows} onCheckedChange={setIncludeSampleRows} />
          </Field>
        )}
        <Button className="md:ml-auto" loading={pending} onClick={submit}>
          Use template
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
