import { TYPE_LABELS, type DatabaseMeta, type Property } from '@carehub/databases';
import { PopoverContent } from '@carehub/ui';
import { useId, useRef, useState, type RefObject } from 'react';
import type { PropertyChange } from '../api';
import { DiscardDrafts, useDraft } from './draft';
import { PROPERTY_TEXT, SETTINGS_TEXT } from './messages';
import type { PropertyActions } from './property-actions';
import { canChangeProperties, checkPropertyName } from './property-logic';
import { ChoiceSetting, DraftField } from './setting-fields';
import { DESCRIPTION_LIMIT, ROW_PAGE_CHOICES } from './settings-logic';
import { PropertyTypeIcon } from './type-icon';

export interface PropertySettingsProps {
  meta: Pick<DatabaseMeta, 'viewerAccess' | 'locked' | 'properties'>;
  property: Property;
  actions: PropertyActions;
  /** A change the server refused (the panel shows the saved settings again). */
  onError?: (error: unknown) => void;
  /** The id of the panel's title, which names the panel. */
  titleId?: string;
}

/**
 * Edit property (spec 3.4): name, description and how it shows on row pages. The settings of each
 * type come next, in this panel. Pickers save at once; typed settings save on Enter or when the
 * field is left.
 */
export function PropertySettings({
  meta,
  property,
  actions,
  onError,
  titleId,
}: PropertySettingsProps) {
  const ownTitleId = useId();
  // Changes on their way to the server show at once; the answer replaces the property.
  const [pending, setPending] = useState<{ base: Property; change: PropertyChange } | null>(null);
  const shown: Property =
    pending?.base === property ? { ...property, ...pending.change } : property;
  const disabled = !canChangeProperties(meta);
  const type = shown.config.type;

  const save = (change: PropertyChange) => {
    setPending((p) => ({
      base: property,
      change: { ...(p?.base === property ? p.change : null), ...change },
    }));
    actions.update(property.id, change).catch((error: unknown) => {
      setPending(null);
      onError?.(error);
    });
  };

  const name = useDraft(shown.name, (text) => {
    const typed = text.trim();
    if (typed === shown.name) return null;
    const problem = checkPropertyName(typed, meta.properties, property.id);
    if (!problem) save({ name: typed });
    return problem;
  });
  const description = useDraft(shown.description, (text) => {
    const typed = text.trim();
    if (typed !== shown.description) save({ description: typed });
    return null;
  });

  return (
    <div className="flex flex-col gap-3">
      <h2 id={titleId ?? ownTitleId} className="text-small font-medium text-fg">
        {SETTINGS_TEXT.title}
      </h2>
      <DraftField label={PROPERTY_TEXT.propertyName} draft={name} disabled={disabled} />
      <DraftField
        label={SETTINGS_TEXT.description}
        draft={description}
        multiline
        maxLength={DESCRIPTION_LIMIT}
        disabled={disabled}
      />
      <p className="flex items-center gap-2 text-small text-fg">
        <span className="text-muted">{SETTINGS_TEXT.type}</span>
        <PropertyTypeIcon type={type} className="text-fg" />
        {TYPE_LABELS[type]}
      </p>
      {type !== 'title' && (
        <ChoiceSetting
          label={SETTINGS_TEXT.rowPage}
          value={shown.rowPage}
          choices={ROW_PAGE_CHOICES}
          disabled={disabled}
          onChange={(rowPage) => save({ rowPage })}
        />
      )}
    </div>
  );
}

export interface PropertySettingsPopoverProps extends Omit<PropertySettingsProps, 'titleId'> {
  /** Where focus goes back when the panel closes and nothing else has it (the header button). */
  returnFocus: RefObject<HTMLElement | null>;
}

/**
 * PropertySettings in the kit's popover; put it inside the <Popover> whose anchor is the header.
 * Escape closes it and drops what's typed in a field; a press outside saves it.
 */
export function PropertySettingsPopover({ returnFocus, ...props }: PropertySettingsPopoverProps) {
  const discard = useRef(false);
  const titleId = useId();
  return (
    <PopoverContent
      align="start"
      aria-labelledby={titleId}
      className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col overflow-y-auto p-3"
      onOpenAutoFocus={() => {
        discard.current = false;
      }}
      onEscapeKeyDown={() => {
        discard.current = true;
      }}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        // A press outside may have put focus in another field (a cell, search): it stays there.
        const active = document.activeElement;
        if (active === null || active === document.body) returnFocus.current?.focus();
      }}
    >
      <DiscardDrafts value={discard}>
        <PropertySettings {...props} titleId={titleId} />
      </DiscardDrafts>
    </PopoverContent>
  );
}
