// The events templates emit (decision 0007, section 2.4), after the database commit.

export type TemplateUsedEvent = {
  /** The workspace template, or null for a starter. */
  templateId: string | null;
  starterKey: string | null;
  /** The new top page, or the page the template was applied to. */
  pageId: string;
  /** Every page made or changed, the top page first. */
  pageIds: string[];
  workspaceId: string;
  by: string;
};

declare module '../../core/events' {
  interface CareHubEvents {
    'template.used': TemplateUsedEvent;
  }
}
