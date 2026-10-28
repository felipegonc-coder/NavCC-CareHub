import {
  searchTemplates,
  TEMPLATE_MESSAGES,
  type TemplateCard,
} from '@carehub/extras/templates/gallery';
import { inCategory } from '@carehub/extras/templates/preview';
import type { UseTarget } from '@carehub/extras/templates/schemas';
import { pageUrl } from '@carehub/shared';
import {
  breakpoints,
  Button,
  cn,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  useMediaQuery,
  useToast,
} from '@carehub/ui';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { usePageTitle } from '../../lib/usePageTitle';
import { useGallery, useTemplateCopy } from './api';
import { originTitle, readOrigin } from './links';
import { addToChoices, TemplatePreview } from './preview';
import { TemplateCardView } from './template-card';

/** Phones: narrower than the kit's `md:` breakpoint. */
const PHONE = `not all and (min-width: ${breakpoints.md})`;
/** The category list's first entry: every template. */
const ALL = 'All templates';

const STEPS: Record<string, 'back' | 'next' | 'up' | 'down'> = {
  ArrowLeft: 'back',
  ArrowRight: 'next',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** How many cards sit in a row of the grid (1 when the browser can't tell). */
function columnsOf(list: HTMLElement | null): number {
  if (!list) return 1;
  const columns = getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length;
  return Math.max(1, columns);
}

/**
 * The template gallery (spec 2 and 6): search, categories, cards, the read-only preview and Use
 * template. The search box has focus; arrow keys move between cards, Enter opens the preview,
 * Ctrl+Enter uses the template, and Esc goes back to the search box.
 */
export function GalleryScreen() {
  usePageTitle('Templates');
  const gallery = useGallery();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const phone = useMediaQuery(PHONE);
  const copy = useTemplateCopy();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [previewing, setPreviewing] = useState<TemplateCard | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const origin = readOrigin(params);
  const choices = addToChoices(origin, originTitle(location.state));
  const data = gallery.data;
  const cards = useMemo(() => data?.templates ?? [], [data]);
  const categories = useMemo(
    () => (data?.categories ?? []).filter((name) => inCategory(cards, name).length > 0),
    [data, cards],
  );
  const searching = query.trim() !== '';
  const shown = searching
    ? searchTemplates(cards, query)
    : category === ALL
      ? cards
      : inCategory(cards, category);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const open = (card: TemplateCard) => {
    copy.reset();
    setPreviewing(card);
  };

  const start = (card: TemplateCard, target: UseTarget, includeSampleRows: boolean) => {
    if (copy.isPending) return;
    const inPreview = previewing !== null;
    copy.mutate(
      { id: card.id, target, includeSampleRows },
      {
        onSuccess: ({ pageId, notCopied }) => {
          if (notCopied.length > 0) toast({ title: TEMPLATE_MESSAGES.notCopied(notCopied) });
          navigate(pageUrl(pageId));
        },
        onError: (error) => {
          if (!inPreview) {
            toast({
              title: 'Couldn’t use the template',
              description: error.message,
              variant: 'danger',
            });
          }
        },
      },
    );
  };
  const startNow = (card: TemplateCard) =>
    start(card, choices[0]?.target ?? { type: 'private' }, true);

  const focusCard = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[data-template-card]');
    if (!buttons || buttons.length === 0) return;
    buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const first = shown[0];
    if (event.key === 'ArrowDown' && first) {
      event.preventDefault();
      focusCard(0);
    } else if (event.key === 'Enter' && first) {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) startNow(first);
      else open(first);
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    }
  };

  const onCardKeyDown = (card: TemplateCard, index: number) => (event: KeyboardEvent) => {
    const step = STEPS[event.key];
    if (step) {
      event.preventDefault();
      const columns = step === 'up' || step === 'down' ? columnsOf(listRef.current) : 1;
      const next = step === 'back' || step === 'up' ? index - columns : index + columns;
      if (next < 0) searchRef.current?.focus();
      else focusCard(Math.min(next, shown.length - 1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      focusCard(event.key === 'Home' ? 0 : shown.length - 1);
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      startNow(card);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      searchRef.current?.focus();
    }
  };

  const heading = searching ? `Results for “${query.trim()}”` : category;
  const count = shown.length === 1 ? '1 template' : `${shown.length} templates`;

  return (
    <main className="flex w-full flex-col gap-6 px-4 py-6 text-fg md:px-6 md:py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-h1">Templates</h1>
        <p className="text-body text-muted">Start from something good instead of a blank page.</p>
      </div>
      <div role="search" className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search templates"
          placeholder="Search templates"
          className="h-11 pl-9"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeyDown}
        />
      </div>
      {gallery.isPending ? (
        <ul aria-hidden className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <li key={key}>
              <Skeleton className="h-40 w-full" />
            </li>
          ))}
        </ul>
      ) : gallery.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p className="text-body">{gallery.error?.message ?? 'Couldn’t load the templates.'}</p>
          <Button variant="secondary" onClick={() => void gallery.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-6 md:flex-row">
          {phone ? (
            <Field label="Category">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[ALL, ...categories].map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <nav aria-label="Categories" className="w-48 shrink-0">
              <ul className="flex flex-col gap-0.5">
                {[ALL, ...categories].map((name) => (
                  <li key={name}>
                    <button
                      type="button"
                      aria-pressed={!searching && category === name}
                      onClick={() => {
                        setCategory(name);
                        setQuery('');
                      }}
                      className={cn(
                        'w-full rounded px-2 py-1.5 text-left text-small hover:bg-fill-hover',
                        !searching && category === name && 'bg-fill font-medium',
                      )}
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <section
            aria-labelledby="templates-heading"
            className="flex min-w-0 flex-1 flex-col gap-3"
          >
            <h2 id="templates-heading" className="text-h3">
              {heading}
            </h2>
            <p role="status" className="sr-only">
              {count}
            </p>
            {shown.length === 0 ? (
              <p className="text-body text-muted">
                {searching ? TEMPLATE_MESSAGES.noResults : 'No templates here yet.'}
              </p>
            ) : (
              <ul
                ref={listRef}
                className={cn(
                  'grid gap-4',
                  phone ? 'grid-cols-1 gap-2' : 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4',
                )}
              >
                {shown.map((card, index) => (
                  <TemplateCardView
                    key={card.id}
                    card={card}
                    compact={phone}
                    onOpen={() => open(card)}
                    onKeyDown={onCardKeyDown(card, index)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <TemplatePreview
        card={previewing}
        onClose={() => setPreviewing(null)}
        choices={choices}
        phone={phone}
        pending={copy.isPending}
        error={previewing ? (copy.error?.message ?? null) : null}
        onUse={(target, includeSampleRows) =>
          previewing && start(previewing, target, includeSampleRows)
        }
      />
    </main>
  );
}
