/**
 * A database on its own page or as a block in a page: its title, view tabs, the toolbar with New,
 * and the chosen view drawn by its layout, with the states of spec section 2 inside the block. It
 * stays up to date while it shows (live.ts).
 */
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  plainText,
  type Id,
  type View,
  type ViewLayout,
  type ViewOverride,
  type Viewer,
} from '@carehub/databases';
import { can } from '@carehub/databases/access';
import { applyOverride } from '@carehub/databases/engine';
import { countConditions } from '@carehub/databases/filter';
import { cn, Tabs, TabsContent } from '@carehub/ui';
import { isApiError, type DatabaseWithVersion } from '../api';
import { DIALOG_PANELS, type LayoutProps, type OpenMode } from '../contract';
import { useDatabase, useViewData } from '../hooks';
import { LAYOUTS } from '../layouts';
import { ErrorBoundary } from './boundary';
import { useDatabaseLive } from './live';
import { PanelDialog, usePanels } from './panel-host';
import { useSearch } from './search';
import {
  Blocked,
  LoadError,
  LoadingRows,
  NoAccess,
  NoMatches,
  NoRows,
  OverrideBar,
} from './states';
import { WithToasts } from './toasts';
import { Toolbar } from './toolbar';
import { useViewActions } from './use-view-actions';
import { useOnline, useViewer } from './viewer';
import { canEditViews, pickView, readLastView, rememberView, tabViews } from './view-state';
import { useDeleteView, ViewTabs } from './view-tabs';

/**
 * Layouts that show "No rows yet." and "No rows match." in place of themselves. The others draw
 * their own frame without rows (board columns, calendar days, the timeline, a chart, a form or a
 * dashboard's tiles).
 */
export const EMPTY_STATE_LAYOUTS: ReadonlySet<ViewLayout> = new Set([
  'table',
  'list',
  'gallery',
  'feed',
]);

export interface DatabaseViewProps {
  databaseId: Id;
  /** A block inside a page: a smaller title, and the toolbar shows on hover or focus. */
  inline?: boolean;
  /** Blocks can hide the title. */
  showTitle?: boolean;
  /** The view the link names (?v= on a database page, or the block's view). */
  viewId?: Id;
  /** The person picked another view, so the link can follow. */
  onViewChange?: (viewId: Id) => void;
  /** Who is looking (until useMe() is on main; tests pass testViewer()). */
  viewer?: Viewer;
  /** Opens a row in a peek or page. Absent: goes to the row's page. */
  onOpenRow?: (rowId: Id, mode: OpenMode) => void;
  /** Delete in the toolbar's "…" (Full access) moves the database to Trash. Absent: no Delete. */
  onDelete?: () => void;
}

export function DatabaseView(props: DatabaseViewProps) {
  return (
    <WithToasts>
      <DatabaseScreen {...props} />
    </WithToasts>
  );
}

function DatabaseScreen(props: DatabaseViewProps) {
  const database = useDatabase(props.databaseId);
  const meta = database.data;
  let body: ReactNode;
  if (meta) body = <LoadedDatabase meta={meta} {...props} />;
  else if (database.isError) {
    const status = isApiError(database.error) ? database.error.status : 0;
    body =
      status === 403 ? (
        <NoAccess />
      ) : (
        <LoadError
          error={database.error}
          onRetry={status === 404 ? undefined : () => void database.refetch()}
        />
      );
  } else body = <LoadingRows layout="table" title />;

  return (
    <section
      data-testid="database"
      data-database-id={props.databaseId}
      className="group/database flex min-w-0 flex-col gap-3"
    >
      {body}
    </section>
  );
}

interface Choice {
  viewId: Id;
  /** The link's view when it was picked: a new link wins over it. */
  link: Id | undefined;
}

function LoadedDatabase({ meta, ...props }: DatabaseViewProps & { meta: DatabaseWithVersion }) {
  useDatabaseLive(meta.id);
  const [lastUsed] = useState(() => readLastView(meta.id));
  const [choice, setChoice] = useState<Choice | null>(null);
  const { onViewChange, viewId: link } = props;
  const pick = useCallback(
    (viewId: Id) => {
      setChoice({ viewId, link });
      onViewChange?.(viewId);
    },
    [link, onViewChange],
  );
  // Views deleted a moment ago are hidden until their Undo is gone.
  const deleted = useDeleteView(meta.id, pick);
  const views = meta.views.filter((v) => !deleted.hidden.has(v.id));
  const wanted = choice && choice.link === props.viewId ? choice.viewId : props.viewId;
  const savedView = pickView(views, wanted, lastUsed);
  const tabs = tabViews(views);

  const shownId = savedView?.id;
  useEffect(() => {
    if (shownId) rememberView(meta.id, shownId);
  }, [meta.id, shownId]);

  const showTitle = props.showTitle ?? true;
  const description = plainText(meta.description);
  const Heading = props.inline ? 'h2' : 'h1';

  return (
    <>
      {showTitle && (
        <header className="flex flex-col gap-1">
          <Heading
            className={cn(
              'flex items-center gap-2 text-fg',
              props.inline ? 'text-body font-semibold' : 'text-title',
            )}
          >
            {meta.icon && <span aria-hidden="true">{meta.icon}</span>}
            <span className="min-w-0 break-words">{meta.title || 'Untitled'}</span>
          </Heading>
          {description && <p className="text-small text-muted">{description}</p>}
        </header>
      )}
      {savedView && (
        <Tabs value={savedView.id} onValueChange={pick} className="flex flex-col gap-3">
          <ViewBody
            {...props}
            meta={meta}
            savedView={savedView}
            tabs={tabs}
            pick={pick}
            deleteView={(viewId) => deleted.remove(viewId, tabs, savedView.id)}
          />
        </Tabs>
      )}
    </>
  );
}

interface ViewBodyProps extends DatabaseViewProps {
  meta: DatabaseWithVersion;
  savedView: View;
  tabs: readonly View[];
  pick(viewId: Id): void;
  deleteView(viewId: Id): void;
}

interface OverrideState {
  viewId: Id;
  override: ViewOverride;
}

function ViewBody({ meta, savedView, tabs, pick, deleteView, ...props }: ViewBodyProps) {
  const viewer = useViewer(props.viewer);
  const online = useOnline();
  // Search and the open panel belong to the view showing: another view starts without them.
  const search = useSearch(savedView.id);
  const panels = usePanels(savedView.id);
  // The viewer's own filter, sorts and grouping last while they stay on the view.
  const [own, setOwn] = useState<OverrideState | null>(null);
  const override = own?.viewId === savedView.id ? own.override : null;
  const setOverride = useCallback(
    (next: ViewOverride | null) => setOwn(next ? { viewId: savedView.id, override: next } : null),
    [savedView.id],
  );
  const view = applyOverride(savedView, override);
  const result = useViewData(meta.id, savedView.id, { override, search: search.query });
  const actions = useViewActions({
    meta,
    savedView,
    view,
    data: result.data,
    viewer,
    override,
    setOverride,
    loadMore: result.loadMore,
    onOpenRow: props.onOpenRow,
  });

  const access = meta.viewerAccess;
  const locked = meta.locked;
  const readOnly = !online || !can('edit_rows', access, { locked });
  const canAdd = online && can('add_rows', access, { locked, canAddRows: meta.viewerCanAddRows });
  const canImport = online && can('import', access, { locked });

  // New uses the view's default template; New ▾ picks one, or an empty row (null).
  const newRow = (templateId?: Id | null) => {
    actions.createRow(templateId === undefined ? undefined : { templateId }).then(
      (row) => actions.openRow(row.id),
      // The toast already says why.
      () => undefined,
    );
  };

  // What a panel gets.
  const shared = {
    meta,
    view,
    savedView,
    viewer,
    actions,
    canEditViews: online && canEditViews(meta),
    // Absent until the view's rows have loaded, and while the view is blocked.
    data: result.data,
    propertyIds: result.data?.propertyIds,
    rowTitles: result.data?.rowTitles,
  };
  const dialog = panels.open !== null && DIALOG_PANELS.has(panels.open) ? panels.open : null;

  const filtered = countConditions(view.filter) > 0;
  const searched = search.query !== '';

  let body: ReactNode;
  if (result.blocked) body = <Blocked message={result.blocked} />;
  else if (!result.data && result.isError) {
    body = <LoadError error={result.error} onRetry={result.refetch} />;
  } else if (!result.data) body = <LoadingRows layout={view.layout} />;
  else if (result.data.count === 0 && EMPTY_STATE_LAYOUTS.has(view.layout)) {
    body =
      filtered || searched ? (
        <NoMatches
          onClearFilters={
            filtered
              ? () => void actions.updateView({ filter: null }).catch(() => undefined)
              : undefined
          }
          onClearSearch={searched ? search.clear : undefined}
        />
      ) : (
        <NoRows
          onNew={canAdd ? () => newRow() : undefined}
          onImportCsv={canImport ? () => panels.show('importCsv') : undefined}
        />
      );
  } else {
    const layoutProps: LayoutProps = { meta, view, data: result.data, viewer, actions, readOnly };
    body = <LayoutFrame key={view.id} layout={view.layout} props={layoutProps} />;
  }

  return (
    <>
      <div className="flex items-end gap-2">
        <ViewTabs
          meta={meta}
          tabs={tabs}
          view={savedView}
          canEdit={shared.canEditViews}
          dropdown={props.inline === true && savedView.tabsAs === 'dropdown'}
          searching={search.open}
          onPick={pick}
          onDelete={deleteView}
        />
        <Toolbar
          {...shared}
          online={online}
          panels={panels}
          search={search}
          onNew={canAdd ? newRow : undefined}
          onDelete={props.onDelete}
          inline={props.inline}
        />
      </div>
      {override && <OverrideBar onReset={() => setOverride(null)} />}
      <TabsContent value={savedView.id} className="min-w-0">
        {body}
      </TabsContent>
      {dialog && (
        <PanelDialog
          {...shared}
          panel={dialog}
          close={panels.close}
          onCloseAutoFocus={panels.closeAutoFocus}
        />
      )}
    </>
  );
}

function LayoutFrame({ layout, props }: { layout: ViewLayout; props: LayoutProps }) {
  const Layout = LAYOUTS[layout];
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingRows layout={layout} />}>
        <Layout {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}
