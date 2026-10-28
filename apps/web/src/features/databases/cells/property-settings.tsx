import {
  TYPE_LABELS,
  type ConfigOf,
  type DatabaseMeta,
  type Property,
  type PropertyConfig,
} from '@carehub/databases';
import { formatUniqueId } from '@carehub/databases/unique-id';
import { PopoverContent } from '@carehub/ui';
import { useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { PropertyChange } from '../api';
import { DiscardDrafts, useDraft } from './draft';
import { PROPERTY_TEXT, SETTINGS_TEXT } from './messages';
import { NumberDisplaySettings } from './number-settings';
import type { PropertyActions } from './property-actions';
import { canChangeProperties, checkPropertyName } from './property-logic';
import { ChoiceSetting, DraftField, SwitchSetting } from './setting-fields';
import {
  dateFormatChoices,
  DESCRIPTION_LIMIT,
  readIdPrefix,
  ROW_PAGE_CHOICES,
  timeFormatChoices,
} from './settings-logic';
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
 * Edit property (spec 3.4): name, description, how it shows on row pages, and the settings of its
 * type: number display; date and time format; one person only and notify; ID prefix.
 * Pickers and switches save at once; typed settings save on Enter or when the field is left.
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
  const config = shown.config;

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
  const saveConfig = (next: PropertyConfig) => save({ config: next });

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

  let section: ReactNode = null;
  switch (config.type) {
    case 'number':
      section = (
        <NumberDisplaySettings
          display={config}
          disabled={disabled}
          onChange={(display) => saveConfig({ ...config, ...display })}
        />
      );
      break;
    case 'date':
    case 'created_time':
    case 'edited_time':
      section = (
        <>
          <ChoiceSetting
            label={SETTINGS_TEXT.dateFormat}
            value={config.format}
            choices={dateFormatChoices()}
            disabled={disabled}
            onChange={(format) => saveConfig({ ...config, format })}
          />
          <ChoiceSetting
            label={SETTINGS_TEXT.timeFormat}
            value={config.timeFormat}
            choices={timeFormatChoices()}
            disabled={disabled}
            onChange={(timeFormat) => saveConfig({ ...config, timeFormat })}
          />
        </>
      );
      break;
    case 'person':
      section = (
        <>
          <SwitchSetting
            label={SETTINGS_TEXT.onePerson}
            checked={config.single}
            disabled={disabled}
            onChange={(single) => saveConfig({ ...config, single })}
          />
          <SwitchSetting
            label={SETTINGS_TEXT.notify}
            checked={config.notify}
            disabled={disabled}
            onChange={(notify) => saveConfig({ ...config, notify })}
          />
        </>
      );
      break;
    case 'unique_id':
      section = <IdPrefixSetting config={config} disabled={disabled} onChange={saveConfig} />;
      break;
  }

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
        <PropertyTypeIcon type={config.type} className="text-fg" />
        {TYPE_LABELS[config.type]}
      </p>
      {section}
      {config.type !== 'title' && (
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

function IdPrefixSetting({
  config,
  disabled,
  onChange,
}: {
  config: ConfigOf<'unique_id'>;
  disabled: boolean;
  onChange: (config: ConfigOf<'unique_id'>) => void;
}) {
  const prefix = useDraft(config.prefix ?? '', (text) => {
    const read = readIdPrefix(text);
    if ('error' in read) return read.error;
    if (read.prefix !== config.prefix) onChange({ ...config, prefix: read.prefix });
    return null;
  });
  const typed = readIdPrefix(prefix.value);
  const example = formatUniqueId('error' in typed ? config.prefix : typed.prefix, 17);
  return (
    <DraftField
      label={SETTINGS_TEXT.prefix}
      draft={prefix}
      hint={SETTINGS_TEXT.prefixExample(example)}
      disabled={disabled}
    />
  );
}
