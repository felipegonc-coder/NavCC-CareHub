/**
 * New, and the arrow next to it (New ▾, spec section 2 and the Templates and buttons spec): the
 * database's templates in order with the default marked "Default", Empty, and "+ New template".
 * People who can change the structure get each template's "…": Edit, Set as default for this
 * view, Set as default for all views and Delete.
 */
import { useState } from 'react';
import { ChevronDown, Ellipsis } from 'lucide-react';
import {
  LIMITS,
  type DatabaseMeta,
  type Id,
  type RowTemplate,
  type View,
} from '@carehub/databases';
import { defaultTemplate } from '@carehub/databases/templates';
import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
} from '@carehub/ui';
import type { ViewActions } from '../contract';
import { useSettingsChange, useUpdateDatabase, useUpdateView } from '../hooks';
import { errorText } from './states';
import { useToasts } from './toasts';

export const TEMPLATE_TEXT = {
  templates: 'Templates',
  default: 'Default',
  empty: 'Empty',
  newTemplate: '+ New template',
  edit: 'Edit',
  forView: 'Set as default for this view',
  forAll: 'Set as default for all views',
  delete: 'Delete',
} as const;

export interface NewButtonProps {
  meta: DatabaseMeta;
  savedView: View;
  actions: ViewActions;
  /** Can edit, Lock structure off and online: "+ New template" and each template's "…". */
  canManage: boolean;
  /** Makes a row and opens it, from the view's default (no argument), a template or none (null). */
  onNew(templateId?: Id | null): void;
  /** The list of templates opens or closes (an inline block keeps its toolbar in sight). */
  onOpenChange?: (open: boolean) => void;
}

export function NewButton(props: NewButtonProps) {
  const { meta, savedView, actions, canManage, onNew } = props;
  const [open, setShown] = useState(false);
  const setOpen = (next: boolean) => {
    setShown(next);
    props.onOpenChange?.(next);
  };
  const toasts = useToasts();
  const settings = useSettingsChange(meta.id);
  const updateDatabase = useUpdateDatabase(meta.id);
  const updateView = useUpdateView(meta.id);
  const { templates } = meta;
  const chosen = defaultTemplate(savedView, meta);
  const refused = (error: unknown) => toasts.show({ message: errorText(error) });

  const pick = (templateId: Id | null) => {
    setOpen(false);
    onNew(templateId);
  };

  const edit = (templateId: Id) => {
    setOpen(false);
    actions.openRow(templateId);
  };

  const newTemplate = async () => {
    setOpen(false);
    try {
      const answer = await settings.mutateAsync((client) => client.createTemplate(meta.id, {}));
      if ('templateId' in answer && typeof answer.templateId === 'string') {
        actions.openRow(answer.templateId);
      }
    } catch (error) {
      refused(error);
    }
  };

  const forAllViews = async (templateId: Id) => {
    try {
      await updateDatabase.mutateAsync({ defaultTemplateId: templateId });
      // Views with a default of their own take this one too.
      for (const view of meta.views) {
        if (view.defaultTemplateId === undefined || view.defaultTemplateId === templateId) continue;
        await updateView.mutateAsync({
          viewId: view.id,
          change: { defaultTemplateId: templateId },
        });
      }
    } catch (error) {
      refused(error);
    }
  };

  const menu = (template: RowTemplate) => ({
    edit: () => edit(template.id),
    forView: () =>
      void actions.updateView({ defaultTemplateId: template.id }).catch(() => undefined),
    forAll: () => void forAllViews(template.id),
    delete: () =>
      void settings
        .mutateAsync((client) => client.deleteTemplate(meta.id, template.id))
        .catch(refused),
  });

  const arrow = templates.length > 0 || canManage;
  const defaultMark = (
    <>
      {' '}
      <span className="text-small text-muted">{TEMPLATE_TEXT.default}</span>
    </>
  );

  return (
    <div className="flex items-center gap-px">
      <Button size="sm" className={cn(arrow && 'rounded-r-none')} onClick={() => onNew()}>
        New
      </Button>
      {arrow && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <IconButton
              label={TEMPLATE_TEXT.templates}
              variant="primary"
              size="sm"
              className="rounded-l-none"
            >
              <ChevronDown aria-hidden />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            aria-label={TEMPLATE_TEXT.templates}
            className="flex w-72 flex-col gap-1 p-1"
          >
            <ul aria-label={TEMPLATE_TEXT.templates} className="flex flex-col">
              {templates.map((template) => (
                <li key={template.id} className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-w-0 flex-1 justify-start"
                    onClick={() => pick(template.id)}
                  >
                    {template.icon && <span aria-hidden="true">{template.icon}</span>}
                    <span className="truncate">{template.name || 'Untitled'}</span>
                    {chosen?.id === template.id && defaultMark}
                  </Button>
                  {canManage && <TemplateMenu template={template} run={menu(template)} />}
                </li>
              ))}
              <li>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => pick(null)}
                >
                  {TEMPLATE_TEXT.empty}
                  {chosen === null && defaultMark}
                </Button>
              </li>
            </ul>
            {canManage && templates.length < LIMITS.templates && (
              <>
                <Separator />
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => void newTemplate()}
                >
                  {TEMPLATE_TEXT.newTemplate}
                </Button>
              </>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

interface TemplateMenuProps {
  template: RowTemplate;
  run: Record<'edit' | 'forView' | 'forAll' | 'delete', () => void>;
}

/** A template's "…". */
function TemplateMenu({ template, run }: TemplateMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={`More actions for ${template.name || 'Untitled'}`} size="sm">
          <Ellipsis aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={run.edit}>{TEMPLATE_TEXT.edit}</DropdownMenuItem>
        <DropdownMenuItem onSelect={run.forView}>{TEMPLATE_TEXT.forView}</DropdownMenuItem>
        <DropdownMenuItem onSelect={run.forAll}>{TEMPLATE_TEXT.forAll}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={run.delete}>
          {TEMPLATE_TEXT.delete}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
