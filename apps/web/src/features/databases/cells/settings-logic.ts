/**
 * Property settings (spec 3.4): row pages and descriptions, number formats and currencies, date and
 * time formats, and ID prefixes.
 */
import {
  CURRENCIES,
  DATE_FORMATS,
  formatCalendarDate,
  formatTime,
  type DateFormat,
  type NumberDecimals,
  type NumberDisplay,
  type Property,
  type TimeFormat,
} from '@carehub/databases';
import { normalizeIdPrefix } from '@carehub/databases/unique-id';
import { VALUE_MESSAGES } from '@carehub/databases/values';
import { DEFAULT_DIVIDE_BY } from './logic';
import { SETTINGS_TEXT } from './messages';

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** The choice a select's value names, or null. */
export function readChoice<T extends string>(
  choices: readonly Choice<T>[],
  value: string,
): T | null {
  return choices.find((choice) => choice.value === value)?.value ?? null;
}

export const ROW_PAGE_CHOICES: readonly Choice<Property['rowPage']>[] = [
  { value: 'always', label: SETTINGS_TEXT.rowPageChoices.always },
  { value: 'hide_when_empty', label: SETTINGS_TEXT.rowPageChoices.hide_when_empty },
  { value: 'always_hide', label: SETTINGS_TEXT.rowPageChoices.always_hide },
];

/** Characters in a property description (the server's request limit). */
export const DESCRIPTION_LIMIT = 280;

/** Currency names for the Number format list, common ones first (the engine's CURRENCIES order). */
export const CURRENCY_NAMES: Readonly<Record<(typeof CURRENCIES)[number], string>> = {
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
  CAD: 'Canadian dollar',
  AUD: 'Australian dollar',
  NZD: 'New Zealand dollar',
  JPY: 'Japanese yen',
  CNY: 'Chinese yuan',
  HKD: 'Hong Kong dollar',
  TWD: 'New Taiwan dollar',
  KRW: 'South Korean won',
  SGD: 'Singapore dollar',
  INR: 'Indian rupee',
  IDR: 'Indonesian rupiah',
  MYR: 'Malaysian ringgit',
  PHP: 'Philippine peso',
  THB: 'Thai baht',
  VND: 'Vietnamese dong',
  CHF: 'Swiss franc',
  SEK: 'Swedish krona',
  NOK: 'Norwegian krone',
  DKK: 'Danish krone',
  PLN: 'Polish zloty',
  CZK: 'Czech koruna',
  HUF: 'Hungarian forint',
  RON: 'Romanian leu',
  TRY: 'Turkish lira',
  ILS: 'Israeli new shekel',
  AED: 'UAE dirham',
  SAR: 'Saudi riyal',
  ZAR: 'South African rand',
  BRL: 'Brazilian real',
  MXN: 'Mexican peso',
  ARS: 'Argentine peso',
  CLP: 'Chilean peso',
  COP: 'Colombian peso',
  PEN: 'Peruvian sol',
  UYU: 'Uruguayan peso',
};

const isListedCurrency = (code: string): code is (typeof CURRENCIES)[number] =>
  Object.hasOwn(CURRENCY_NAMES, code);

/** A Number format choice: number, number with commas, percent, or one currency ("currency:EUR"). */
export type NumberFormatKey = 'number' | 'number_commas' | 'percent' | `currency:${string}`;

export function numberFormatKey(d: Pick<NumberDisplay, 'format' | 'currency'>): NumberFormatKey {
  return d.format === 'currency' ? `currency:${d.currency}` : d.format;
}

/** The Number format list; a currency set some other way (any code Intl knows) stays on it. */
export function numberFormatChoices(
  d: Pick<NumberDisplay, 'format' | 'currency'>,
): Choice<NumberFormatKey>[] {
  const choices: Choice<NumberFormatKey>[] = [
    { value: 'number', label: SETTINGS_TEXT.formats.number },
    { value: 'number_commas', label: SETTINGS_TEXT.formats.number_commas },
    { value: 'percent', label: SETTINGS_TEXT.formats.percent },
    ...CURRENCIES.map((code) => ({
      value: `currency:${code}` as const,
      label: CURRENCY_NAMES[code],
    })),
  ];
  if (d.format === 'currency' && !isListedCurrency(d.currency)) {
    choices.push({ value: `currency:${d.currency}`, label: d.currency });
  }
  return choices;
}

/** The display with the format picked from the list. */
export function withNumberFormat<D extends NumberDisplay>(d: D, key: string): D {
  if (key.startsWith('currency:')) return { ...d, format: 'currency', currency: key.slice(9) };
  if (key === 'number' || key === 'number_commas' || key === 'percent')
    return { ...d, format: key };
  return d;
}

export const DECIMALS: readonly NumberDecimals[] = ['auto', 0, 1, 2, 3, 4];

export const decimalsLabel = (d: NumberDecimals): string =>
  d === 'auto' ? SETTINGS_TEXT.automatic : String(d);

export const readDecimals = (value: string): NumberDecimals =>
  DECIMALS.find((d) => String(d) === value) ?? 'auto';

export const SHOW_AS_CHOICES: readonly Choice<NumberDisplay['showAs']>[] = [
  { value: 'number', label: SETTINGS_TEXT.showAsChoices.number },
  { value: 'bar', label: SETTINGS_TEXT.showAsChoices.bar },
  { value: 'ring', label: SETTINGS_TEXT.showAsChoices.ring },
];

/** Bar and ring need a "divide by"; it starts at 100. */
export function withShowAs<D extends NumberDisplay>(d: D, showAs: NumberDisplay['showAs']): D {
  if (showAs === 'number') return { ...d, showAs };
  return { ...d, showAs, divideBy: d.divideBy ?? DEFAULT_DIVIDE_BY };
}

/** A typed "divide by": a number above 0, or why not. */
export function readDivideBy(text: string): { value: number } | { error: string } {
  const t = text.trim().replace(/,/g, '');
  const value = Number(t);
  if (!t || !Number.isFinite(value)) return { error: VALUE_MESSAGES.number };
  if (value <= 0) return { error: SETTINGS_TEXT.divideByPositive };
  return { value };
}

/** Date formats, each shown as Oct 26, 2026 would look. */
export function dateFormatChoices(): Choice<DateFormat>[] {
  return DATE_FORMATS.map((format) => ({
    value: format,
    label:
      format === 'relative' ? SETTINGS_TEXT.relative : formatCalendarDate('2026-10-26', format),
  }));
}

const TIME_FORMATS: readonly TimeFormat[] = ['viewer', '12h', '24h', 'hidden'];

export function timeFormatChoices(): Choice<TimeFormat>[] {
  const label: Record<TimeFormat, string> = {
    viewer: SETTINGS_TEXT.timeViewer,
    '12h': SETTINGS_TEXT.time12(formatTime(15, 30, true)),
    '24h': SETTINGS_TEXT.time24(formatTime(15, 30, false)),
    hidden: SETTINGS_TEXT.timeHidden,
  };
  return TIME_FORMATS.map((value) => ({ value, label: label[value] }));
}

const PREFIX = /^[A-Za-z0-9_-]{1,20}$/;

/** A typed ID prefix as saved (null: none), or why it can't be used. */
export function readIdPrefix(text: string): { prefix: string | null } | { error: string } {
  const prefix = normalizeIdPrefix(text);
  if (prefix === null || PREFIX.test(prefix)) return { prefix };
  return { error: SETTINGS_TEXT.prefixInvalid };
}
