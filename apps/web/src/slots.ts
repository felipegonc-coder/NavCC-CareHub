import type { ComponentType, ReactNode } from 'react';

// Stand-ins until the real types land; each owner replaces its own line.
type PermissionKey = string; // accounts PR: `import type { PermissionKey } from '@carehub/shared';`

type SlotPage = { id: string; kind: 'page' | 'database' | 'row'; title: string }; // page model PR

// The editor PR replaces these with its own types, and ReactNodeViewProps with the one from
// @tiptap/react; until then `never` accepts any component.
type EditorExtension = unknown;
type EditorSlashItem = unknown;
type EditorBubbleItem = unknown;
type ReactNodeViewProps = never;

/** An icon component; the caller sets its size and colour. */
export type SlotIcon = ComponentType<{ className?: string }>;

/** A top item in the sidebar, such as Messages with its unread badge. */
export interface SidebarItem {
  id: string;
  label: string;
  icon: SlotIcon;
  to: string;
  order: number;
  /** A React hook giving the badge number; undefined shows no badge. */
  useBadge?(): number | undefined;
}

/** A block under the top sidebar items, such as upcoming events. */
export interface SidebarSection {
  id: string;
  order: number;
  Component: ComponentType;
}

/** A section of Settings, at `/settings/<path>`. */
export interface SettingsSection {
  id: string;
  label: string;
  path: string;
  order: number;
  /** Who sees it: people with this permission, or only site admins. Everyone when left out. */
  permission?: PermissionKey | 'siteAdmin';
  element: ReactNode;
}

/** What a command gets when it runs. */
export interface CommandContext {
  navigate(to: string): void;
}

/** An entry of the Ctrl+K command menu. */
export interface Command {
  id: string;
  title: string;
  keywords?: string[];
  group?: string;
  permission?: PermissionKey | 'siteAdmin';
  run(ctx: CommandContext): void | Promise<void>;
}

/** An item of the page '…' menu, such as "Remind me". */
export interface PageMenuItem {
  id: string;
  label: string;
  icon?: SlotIcon;
  order: number;
  isVisible?(page: SlotPage): boolean;
  onSelect(page: SlotPage): void;
}

/** The page view shows `database` for pages of kind 'database'. */
export interface PageKindViews {
  database?: ComponentType<{ page: SlotPage }>;
}

/** Shown above the editor by page kind, such as a row's properties. */
export interface PageHeaderExtras {
  row?: ComponentType<{ page: SlotPage }>;
}

/** Another source of links in the editor; `pick` returns a relative link, or null if cancelled. */
export interface LinkPicker {
  label: string;
  pick(): Promise<string | null>;
}

/** Rendered once by the app shell, outside every screen: the Ctrl+K window, the assistant panel. */
export interface Overlay {
  id: string;
  Component: ComponentType;
}

/** Shown above a page's title, in `order`, such as "Archived" or an article's verification. */
export interface PageBanner {
  id: string;
  order: number;
  Component: ComponentType<{ page: SlotPage }>;
}

/** Additions to the page editor, such as the `database` block and "/database". */
export interface EditorSlots {
  /** React views for blocks, by node name. */
  nodeViews?: Record<string, ComponentType<ReactNodeViewProps>>;
  slashItems?: EditorSlashItem[];
  linkPickers?: LinkPicker[];
  bubbleItems?: EditorBubbleItem[];
  extensions?: EditorExtension[];
}

/** Everything web features add to the shell, page view and editor (decision 0007, section 5.3). */
export interface Slots {
  sidebarItems: SidebarItem[];
  sidebarSections: SidebarSection[];
  settingsSections: SettingsSection[];
  commands: Command[];
  pageMenuItems: PageMenuItem[];
  pageKindViews: PageKindViews;
  pageHeaderExtras: PageHeaderExtras;
  overlays: Overlay[];
  pageBanners: PageBanner[];
  editor: EditorSlots;
}

/** What `features/<f>/slots.ts` exports as `slots`. */
export type FeatureSlots = Partial<Slots>;

/** The merged slots, with every editor list present. */
export type MergedSlots = Omit<Slots, 'editor'> & { editor: Required<EditorSlots> };

type SlotsModule = { slots?: FeatureSlots };

/**
 * Merges feature slots in line order: lists are joined and sorted by `order` (ties keep line
 * order; commands keep line order), objects are merged with later lines winning.
 */
export function mergeSlots(parts: readonly FeatureSlots[]): MergedSlots {
  const join = <T>(pick: (part: FeatureSlots) => T[] | undefined): T[] =>
    parts.flatMap((part) => pick(part) ?? []);
  const sorted = <T extends { order: number }>(items: T[]): T[] =>
    items.sort((a, b) => a.order - b.order);
  return {
    sidebarItems: sorted(join((part) => part.sidebarItems)),
    sidebarSections: sorted(join((part) => part.sidebarSections)),
    settingsSections: sorted(join((part) => part.settingsSections)),
    commands: join((part) => part.commands),
    pageMenuItems: sorted(join((part) => part.pageMenuItems)),
    pageKindViews: Object.assign({}, ...parts.map((part) => part.pageKindViews)),
    pageHeaderExtras: Object.assign({}, ...parts.map((part) => part.pageHeaderExtras)),
    overlays: join((part) => part.overlays),
    pageBanners: sorted(join((part) => part.pageBanners)),
    editor: {
      nodeViews: Object.assign({}, ...parts.map((part) => part.editor?.nodeViews)),
      slashItems: join((part) => part.editor?.slashItems),
      linkPickers: join((part) => part.editor?.linkPickers),
      bubbleItems: join((part) => part.editor?.bubbleItems),
      extensions: join((part) => part.editor?.extensions),
    },
  };
}

// Each web feature replaces only its own line below with `() => import('./features/<f>/slots'),`
// so parallel pull requests never edit the same lines (prettier-ignore keeps the blank lines).
// prettier-ignore
const featureSlots: (() => Promise<SlotsModule>)[] = [
  // feature: auth

  // feature: status

  // feature: design

  // feature: shell

  () => import('./features/home/slots'), // feature: home

  // feature: pages

  // feature: settings

  () => import('./features/search/slots'), // feature: search

  () => import('./features/history/slots'), // feature: history

  () => import('./features/templates/slots'), // feature: templates

  () => import('./features/import-export/slots'), // feature: import-export

  () => import('./features/knowledge/slots'), // feature: knowledge

  // feature: learning

  // feature: databases
  () => import('./features/databases/slots'),
  // feature: forms

  // feature: messages

  () => import('./features/calendar/slots'), // feature: calendar

  // feature: meetings

  // feature: automations

  // feature: analytics

  () => import('./features/notifications/slots'),

  () => import('./features/claude/slots'), // feature: claude

  // feature: comments

  // feature: files

  // feature: live

  // feature: jobs

  // feature: push

  // feature: reminders

  // feature: notices
];

/** The merged slots of every feature. The shell, page view and editor read only from here. */
export const slots: MergedSlots = mergeSlots([]);

/**
 * Loads every feature's slots into `slots`; main.tsx waits for it before the first render. A
 * feature whose slots fail to load is left out and logged, so the rest of the app still works.
 */
export async function loadSlots(loaders = featureSlots): Promise<void> {
  const results = await Promise.allSettled(loaders.map(async (load) => (await load()).slots ?? {}));
  const parts: FeatureSlots[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') parts.push(result.value);
    else console.error('A feature failed to load its slots.', result.reason);
  }
  Object.assign(slots, mergeSlots(parts));
}
