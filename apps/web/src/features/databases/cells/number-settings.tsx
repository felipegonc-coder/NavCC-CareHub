import { OPTION_COLORS, type NumberDisplay } from '@carehub/databases';
import { Field } from '@carehub/ui';
import { NativeSelect } from './controls';
import { useDraft } from './draft';
import { DEFAULT_DIVIDE_BY } from './logic';
import { OPTION_COLOR_LABELS, SETTINGS_TEXT } from './messages';
import { ChoiceSetting, DraftField, SwitchSetting } from './setting-fields';
import {
  DECIMALS,
  decimalsLabel,
  numberFormatChoices,
  numberFormatKey,
  readDecimals,
  readDivideBy,
  SHOW_AS_CHOICES,
  withNumberFormat,
  withShowAs,
} from './settings-logic';

export interface NumberDisplaySettingsProps {
  display: NumberDisplay;
  onChange: (display: NumberDisplay) => void;
  disabled?: boolean;
}

/**
 * How a number shows: format (number, with commas, percent or a currency), decimals, and show as
 * number, bar or ring (with divide by, color and show number). Formula and rollup settings can use
 * it for their number results.
 */
export function NumberDisplaySettings({
  display,
  onChange,
  disabled = false,
}: NumberDisplaySettingsProps) {
  const divideBy = useDraft(String(display.divideBy ?? DEFAULT_DIVIDE_BY), (text) => {
    const read = readDivideBy(text);
    if ('error' in read) return read.error;
    if (read.value !== display.divideBy) onChange({ ...display, divideBy: read.value });
    return null;
  });
  return (
    <>
      <ChoiceSetting
        label={SETTINGS_TEXT.numberFormat}
        value={numberFormatKey(display)}
        choices={numberFormatChoices(display)}
        disabled={disabled}
        onChange={(key) => onChange(withNumberFormat(display, key))}
      />
      <Field label={SETTINGS_TEXT.decimals}>
        <NativeSelect
          value={String(display.decimals)}
          disabled={disabled}
          onChange={(event) => onChange({ ...display, decimals: readDecimals(event.target.value) })}
        >
          {DECIMALS.map((d) => (
            <option key={d} value={String(d)}>
              {decimalsLabel(d)}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <ChoiceSetting
        label={SETTINGS_TEXT.showAs}
        value={display.showAs}
        choices={SHOW_AS_CHOICES}
        disabled={disabled}
        onChange={(showAs) => onChange(withShowAs(display, showAs))}
      />
      {display.showAs !== 'number' && (
        <>
          <DraftField
            label={SETTINGS_TEXT.divideBy}
            draft={divideBy}
            inputMode="decimal"
            disabled={disabled}
          />
          <ChoiceSetting
            label={SETTINGS_TEXT.color}
            value={display.color}
            choices={OPTION_COLORS.map((color) => ({
              value: color,
              label: OPTION_COLOR_LABELS[color],
            }))}
            disabled={disabled}
            onChange={(color) => onChange({ ...display, color })}
          />
          <SwitchSetting
            label={SETTINGS_TEXT.showNumber}
            checked={display.showNumber}
            disabled={disabled}
            onChange={(showNumber) => onChange({ ...display, showNumber })}
          />
        </>
      )}
    </>
  );
}
