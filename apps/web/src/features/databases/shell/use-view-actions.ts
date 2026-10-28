/**
 * The ViewActions a layout gets: each change shows at once, rolls back if the server refuses, and
 * then the shell says why in a toast. The object stays the same between renders.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { DatabaseMeta, Id, View, ViewOverride, Viewer } from '@carehub/databases';
import { defaultTemplate } from '@carehub/databases/templates';
import { pageUrl } from '@carehub/shared';
import { personChoice, type ButtonRunAnswer, type RunOpen } from '../api';
import { findQueryRow, savedOptionIds } from '../cache';
import { openButtonLink } from '../cells/button-links';
import {
  cellContext,
  type OpenMode,
  type PanelName,
  type PanelTarget,
  type ViewActions,
  type ViewData,
} from '../contract';
import {
  membersQuery,
  useAddOptions,
  useCreateRow,
  useDatabaseClient,
  useDuplicateRows,
  useMoveRow,
  useRestoreRows,
  useTrashRows,
  useUpdateValues,
  useUpdateView,
} from '../hooks';
import { useConfirm } from './confirm';
import { moveValues } from './moves';
import { pressToast } from './press';
import { errorText } from './states';
import { useToasts } from './toasts';
import { canEditViews, mergeOverride } from './view-state';

export interface ViewActionsInput {
  meta: DatabaseMeta;
  /** The view as saved for everyone. */
  savedView: View;
  /** The view as shown: the saved view with the viewer's own changes. */
  view: View;
  data: ViewData | undefined;
  viewer: Viewer;
  override: ViewOverride | null;
  setOverride(override: ViewOverride | null): void;
  loadMore(groupKey?: string, subGroupKey?: string): Promise<void>;
  /** Opens a row in a peek or page. Absent: goes to the row's page. */
  onOpenRow?: (rowId: Id, mode: OpenMode) => void;
  /** Shows a toolbar panel (Panels.show). */
  openPanel(panel: PanelName, target?: PanelTarget, opener?: HTMLElement | null): void;
}

/** "Moved to Trash." or "Moved 3 rows to Trash." */
export function trashedText(count: number): string {
  return count === 1 ? 'Moved to Trash.' : `Moved ${count} rows to Trash.`;
}

export function useViewActions(input: ViewActionsInput): ViewActions {
  const databaseId = input.meta.id;
  const tools = {
    input,
    navigate: useNavigate(),
    toasts: useToasts(),
    confirm: useConfirm(),
    client: useDatabaseClient(),
    queryClient: useQueryClient(),
    createRow: useCreateRow(databaseId),
    updateValues: useUpdateValues(databaseId),
    addOptions: useAddOptions(databaseId),
    duplicateRows: useDuplicateRows(databaseId),
    trashRows: useTrashRows(databaseId),
    restoreRows: useRestoreRows(databaseId),
    moveRow: useMoveRow(databaseId, input.savedView.id),
    updateView: useUpdateView(databaseId),
  };
  const latest = useRef(tools);
  useLayoutEffect(() => {
    latest.current = tools;
  });

  return useMemo<ViewActions>(() => {
    const now = () => latest.current;
    /** Says why the server refused, then passes the error on. */
    const refused = (error: unknown): never => {
      now().toasts.show({ message: errorText(error) });
      throw error;
    };
    /** Where a run's "Open a page" or "Open a link" step goes: pages as openRow, links as cells do. */
    const openStep = (step: RunOpen) => {
      const { input, navigate } = now();
      if (step.kind === 'link') openButtonLink(step.url);
      else if (step.openIn === 'new_tab') window.open(pageUrl(step.pageId), '_blank', 'noopener');
      else if (step.openIn !== 'full_page' && input.onOpenRow) {
        input.onOpenRow(step.pageId, step.openIn);
      } else void navigate(pageUrl(step.pageId));
    };
    /** Undo on a run: the note says what it can't take back (sent messages). */
    const undoRun = (runId: Id) => {
      const { input, client, toasts } = now();
      client.undoButtonRun(input.meta.id, runId).then(
        (answer) => {
          if (answer.note) toasts.show({ message: answer.note });
        },
        (error: unknown) => toasts.show({ message: errorText(error) }),
      );
    };

    return {
      openRow(rowId, mode) {
        const { input, navigate } = now();
        const where = mode ?? input.view.openPagesIn;
        if (input.onOpenRow) input.onOpenRow(rowId, where);
        else void navigate(pageUrl(rowId));
      },

      async createRow(newRow = {}) {
        const { input, createRow } = now();
        // null stays: it asks for an empty row, where leaving it out means the view's default.
        const templateId =
          newRow.templateId === undefined
            ? defaultTemplate(input.savedView, input.meta)?.id
            : newRow.templateId;
        try {
          return await createRow.mutateAsync({
            title: newRow.title,
            values: newRow.values,
            templateId,
            viewId: input.savedView.id,
            groupKey: newRow.groupKey,
            afterRowId: newRow.afterRowId,
          });
        } catch (error) {
          return refused(error);
        }
      },

      async updateValues(rowId, values, newOptions) {
        try {
          return await now().updateValues.mutateAsync({ rowId, values, newOptions });
        } catch (error) {
          return refused(error);
        }
      },

      async addOptions(propertyId, options) {
        try {
          const meta = await now().addOptions.mutateAsync({ propertyId, options });
          return savedOptionIds(
            meta.properties.find((p) => p.id === propertyId),
            options,
          );
        } catch (error) {
          return refused(error);
        }
      },

      async searchPeople(query) {
        const { client, queryClient } = now();
        const members = await queryClient.fetchQuery(membersQuery(client, query.trim()));
        return members.map(personChoice);
      },

      async duplicateRows(rowIds) {
        const ids = [...rowIds];
        if (ids.length === 0) return [];
        try {
          return await now().duplicateRows.mutateAsync(ids);
        } catch (error) {
          return refused(error);
        }
      },

      async trashRows(rowIds) {
        const ids = [...rowIds];
        if (ids.length === 0) return;
        try {
          await now().trashRows.mutateAsync(ids);
        } catch (error) {
          refused(error);
        }
        now().toasts.show({
          message: trashedText(ids.length),
          onUndo: () => {
            now()
              .restoreRows.mutateAsync(ids)
              .catch((error: unknown) => now().toasts.show({ message: errorText(error) }));
          },
        });
      },

      async pressButton(rowId, propertyId) {
        const { input, client, confirm } = now();
        // A confirmation step asks first; Continue presses again, one step further.
        const press = async (confirmed: number): Promise<ButtonRunAnswer> => {
          const answer = await client
            .pressButton(input.meta.id, rowId, propertyId, confirmed)
            .catch(refused);
          if (answer.status !== 'confirm') return answer;
          if (!(await confirm(answer))) throw new Error('The press was cancelled.');
          return press(confirmed + 1);
        };
        // What the run changed comes through live updates, as anyone's changes do.
        const run = await press(0);
        const toast = pressToast(run);
        if (toast) {
          now().toasts.show({
            message: toast.message,
            onUndo: toast.undo ? () => undoRun(run.runId) : undefined,
          });
        }
        for (const step of run.open ?? []) openStep(step);
        if (run.status === 'failed') throw new Error(toast?.message);
      },

      async moveRow(rowId, place) {
        const { input, moveRow } = now();
        const { view, data, meta, viewer } = input;
        const ctx = cellContext(meta, data ?? { rowTitles: {} }, viewer);
        const row = data ? findQueryRow(data, rowId) : undefined;
        const values = moveValues(row, view, place, { ...ctx, properties: meta.properties });
        // A group that can't set the value keeps the row where it was.
        if (!values) return;
        const changesGroup = Object.keys(values).length > 0;
        // Sorted views keep their order: dragging only changes groups.
        const keepOrder = view.sorts.length === 0;
        if (!changesGroup && !keepOrder) return;
        try {
          await moveRow.mutateAsync({
            rowId,
            place,
            values: changesGroup ? values : undefined,
            keepOrder,
          });
        } catch (error) {
          refused(error);
        }
      },

      async updateView(patch) {
        const { input, updateView } = now();
        if (!canEditViews(input.meta)) {
          input.setOverride(mergeOverride(input.override, patch));
          return;
        }
        try {
          await updateView.mutateAsync({ viewId: input.savedView.id, change: patch });
        } catch (error) {
          refused(error);
        }
      },

      setOverride(override) {
        now().input.setOverride(override);
      },

      async loadMore(groupKey, subGroupKey) {
        try {
          await now().input.loadMore(groupKey, subGroupKey);
        } catch (error) {
          refused(error);
        }
      },

      openPanel(panel, target, opener) {
        now().input.openPanel(panel, target, opener);
      },
    };
  }, []);
}
