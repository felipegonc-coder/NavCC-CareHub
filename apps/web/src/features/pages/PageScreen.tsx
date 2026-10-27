// A page at /p/:pageId (Pages and blocks, section 2): the top bar, the header, then the blocks.
import {
  BlockEditor,
  type AnyExtension,
  type Editor,
  type NodeViews,
  type SlashItem,
} from '@carehub/editor';
import { Button, buttonClasses, cn, Skeleton, VisuallyHidden } from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { slots } from '../../slots';
import { atLeast, pageUrl } from './access';
import { useEntryActions } from './actions';
import { fetchPage, pagesKeys, type PageDetail } from './api';
import { usePageDoc } from './doc';
import { useMoveDialogs } from './MoveDialog';
import { startItems, tabTitle } from './page';
import { PageBanner } from './PageBanner';
import { columnClasses, PageHeader } from './PageHeader';
import { PageTopBar, TopBarSkeleton } from './PageTopBar';

/** Not found and no access don't get better by asking again. */
const retry = (count: number, error: unknown) =>
  !(error instanceof ApiError && error.status < 500) && count < 3;

export function PageScreen() {
  const { pageId = '' } = useParams();
  const page = useQuery({
    queryKey: pagesKeys.page(pageId),
    queryFn: () => fetchPage(pageId),
    enabled: pageId !== '',
    retry,
  });
  if (page.data) return <PageView key={page.data.id} page={page.data} />;
  if (page.error || !pageId) {
    const status = page.error instanceof ApiError ? page.error.status : pageId ? 0 : 404;
    if (status === 404) {
      return <Problem title="Not found" text="This was deleted, or the link is wrong." />;
    }
    if (status === 403) return <Problem title="No access" text="You don't have access to this." />;
    return (
      <Problem title="Couldn't open the page" text="Something went wrong on our side.">
        <Button variant="secondary" onClick={() => void page.refetch()}>
          Retry
        </Button>
      </Problem>
    );
  }
  return <Loading />;
}

interface ProblemProps {
  title: string;
  text: string;
  /** What to do instead of going Home. */
  children?: ReactNode;
}

function Problem({ title, text, children }: ProblemProps) {
  return (
    <main className="mx-auto flex w-full max-w-page flex-col items-start gap-3 px-6 py-16">
      <title>{`Care Hub · ${title}`}</title>
      <h1 className="text-title">{title}</h1>
      <p className="text-muted">{text}</p>
      {children ?? (
        <Link to="/" className={buttonClasses({ variant: 'secondary' })}>
          Go to Home
        </Link>
      )}
    </main>
  );
}

/** The top bar and 6 grey lines, only once loading has taken 300 ms. */
function Loading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLate(true), 300);
    return () => clearTimeout(timer);
  }, []);
  if (!late) return <main />;
  return (
    <main className={cn(columnClasses(false), 'flex flex-col gap-3 pt-24')}>
      <TopBarSkeleton />
      <VisuallyHidden role="status">Loading the page</VisuallyHidden>
      {['w-1/2', 'w-full', 'w-11/12', 'w-full', 'w-3/4', 'w-2/3'].map((width, index) => (
        <Skeleton key={index} className={cn(index === 0 ? 'mb-4 h-10' : 'h-5', width)} />
      ))}
    </main>
  );
}

function PageView({ page }: { page: PageDetail }) {
  const navigate = useNavigate();
  const location = useLocation();
  const doc = usePageDoc(page.id);
  const { host } = useMoveDialogs();
  const actions = useEntryActions(host);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [empty, setEmpty] = useState(true);
  const [started, setStarted] = useState(false);
  const editable = atLeast(page.access, 'edit') && !page.locked && !page.archived && !page.deleted;
  const focusTitle = (location.state as { focusTitle?: unknown } | null)?.focusTitle === true;
  const parent = page.path[page.path.length - 1];
  const parentId = parent && parent.kind !== 'space' ? parent.id : null;

  useEffect(() => {
    if (!editor) return;
    const update = () => {
      setEmpty(editor.isEmpty);
      if (!editor.isEmpty) setStarted(true);
    };
    update();
    editor.on('update', update);
    return () => void editor.off('update', update);
  }, [editor]);

  // Ctrl+Shift+U (Cmd+Shift+U on a Mac) goes to the parent page.
  useEffect(() => {
    if (!parentId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'u') return;
      event.preventDefault();
      void navigate(pageUrl(parentId));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate, parentId]);

  const slotPage = { id: page.id, kind: page.kind, title: page.title };
  const DatabaseView = slots.pageKindViews.database;
  const RowExtras = page.kind === 'row' ? slots.pageHeaderExtras.row : undefined;
  const choices = startItems(slots.editor.slashItems as SlashItem[]);
  const column = columnClasses(page.fullWidth);

  return (
    <main className="flex flex-col pb-32">
      <title>{tabTitle(page)}</title>
      <PageTopBar page={page} actions={actions} />
      <PageBanner page={page} />
      <PageHeader
        page={page}
        editable={editable}
        autoFocus={focusTitle && editable}
        onEnter={() => {
          setStarted(true);
          editor?.commands.focus('start');
        }}
      />
      {RowExtras && (
        <div className={column}>
          <RowExtras page={slotPage} />
        </div>
      )}
      {page.kind === 'database' ? (
        <div className={cn(column, 'pt-4')}>
          {DatabaseView ? (
            <DatabaseView page={slotPage} />
          ) : (
            <p className="text-muted">Databases can&apos;t open here yet.</p>
          )}
        </div>
      ) : (
        <>
          {editable && empty && !started && (
            <StartHint
              className={column}
              choices={choices}
              onPick={(item) => {
                setStarted(true);
                if (editor) item.run(editor);
              }}
            />
          )}
          <BlockEditor
            ydoc={doc.ydoc}
            provider={doc.provider}
            editable={editable}
            nodeViews={slots.editor.nodeViews as NodeViews}
            extensions={slots.editor.extensions as AnyExtension[]}
            onReady={setEditor}
            className={cn(column, 'pt-4')}
          />
        </>
      )}
    </main>
  );
}

interface StartHintProps {
  className: string;
  choices: { label: string; item: SlashItem }[];
  onPick(item: SlashItem): void;
}

/** Under the title of a new empty page; typing or pressing Enter hides it (section 2). */
function StartHint({ className, choices, onPick }: StartHintProps) {
  return (
    <div className={cn(className, 'flex flex-wrap items-center gap-x-1 gap-y-2 pt-4 text-muted')}>
      <span>Press Enter to start writing, or start with:</span>
      {choices.map(({ label, item }) => (
        <Button key={item.id} variant="secondary" size="sm" onClick={() => onPick(item)}>
          {label}
        </Button>
      ))}
    </div>
  );
}
