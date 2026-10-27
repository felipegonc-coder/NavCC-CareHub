// A page at /p/:pageId (Pages and blocks, section 2): the top bar, the header, then the blocks.
import { atLeast, pageUrl } from '@carehub/shared';
import {
  BlockEditor,
  type AnyExtension,
  type Editor,
  type NodeViews,
  type SlashItem,
} from '@carehub/editor';
import { Button, cn } from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ApiError } from '../../lib/api';
import { slots } from '../../slots';
import { useEntryActions } from './actions';
import { AddTo } from './AddTo';
import { fetchPage, pagesKeys, type PageDetail } from './api';
import { usePageDoc } from './doc';
import { useMoveDialogs } from './MoveDialog';
import { startItems, tabTitle } from './page';
import { PageBanner } from './PageBanner';
import { columnClasses, PageHeader } from './PageHeader';
import { asTreeNode, PageMenu } from './PageMenu';
import { Loading, Problem } from './PageStates';
import { PageTopBar } from './PageTopBar';

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

function PageView({ page }: { page: PageDetail }) {
  const navigate = useNavigate();
  const location = useLocation();
  const doc = usePageDoc(page.id);
  const { host, dialogs } = useMoveDialogs();
  const actions = useEntryActions(host);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [empty, setEmpty] = useState(true);
  const [started, setStarted] = useState(false);
  const editable = atLeast(page.access, 'edit') && !page.locked && !page.archived && !page.deleted;
  const state = location.state as { focusTitle?: unknown; addTo?: unknown } | null;
  const focusTitle = state?.focusTitle === true;
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
      <PageTopBar page={page} actions={actions}>
        <PageMenu page={page} actions={actions} editor={editor} />
      </PageTopBar>
      {state?.addTo === true && (
        <AddTo page={page} onChoose={() => actions.chooseMove(asTreeNode(page), 'add')} />
      )}
      <PageBanner page={page} />
      {slots.pageBanners.map(({ id, Component }) => (
        <Component key={id} page={slotPage} />
      ))}
      <PageHeader
        page={page}
        editable={editable}
        focusTitle={focusTitle && editable}
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
      {dialogs(actions.move)}
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
