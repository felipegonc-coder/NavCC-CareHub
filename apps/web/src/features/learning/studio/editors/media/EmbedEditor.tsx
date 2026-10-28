import { isHttpsUrl, LIMITS, toEmbed, type EmbedBlock } from '@carehub/learning';
import { Field, Input } from '@carehub/ui';
import type { BlockEditorProps } from '../registry';
import { CheckedField, type Checked } from './CheckedField';
import { withOptional } from './optional';

const { min, max } = LIMITS.embedHeight;

/** A link the allow-list accepts: as typed, or the embed address of a pasted embed code. */
function checkLink(text: string): Checked<string> {
  const input = text.trim();
  const checked = toEmbed(input);
  if (!checked.ok) return { ok: false, error: checked.reason };
  return { ok: true, value: isHttpsUrl(input) ? input : checked.embed.embedUrl };
}

/** A height in pixels within the limits; empty for the usual height. */
function checkHeight(text: string): Checked<number | undefined> {
  if (text.trim() === '') return { ok: true, value: undefined };
  const height = Number(text);
  return Number.isInteger(height) && height >= min && height <= max
    ? { ok: true, value: height }
    : { ok: false, error: `Use a whole number from ${min} to ${max.toLocaleString('en')}.` };
}

/** An embed block: the page's link (allow-listed sites only), its title and, for forms and documents, a height. */
export function EmbedEditor({ block, onChange }: BlockEditorProps<EmbedBlock>) {
  const check = toEmbed(block.url);
  return (
    <div className="flex flex-col gap-5">
      <CheckedField
        label="Link or embed code"
        hint="A video, form or document from a site Care Hub can show."
        value={block.url}
        check={checkLink}
        onChange={(url) => onChange({ ...block, url })}
        input={{ maxLength: LIMITS.url }}
      />
      <Field label="Title" hint="Says what the page is, for screen readers too.">
        <Input
          value={block.title}
          maxLength={LIMITS.title}
          onChange={(event) => onChange({ ...block, title: event.target.value })}
        />
      </Field>
      {check.ok && check.embed.kind !== 'video' && (
        <CheckedField
          label="Height (pixels)"
          hint="Optional. Videos keep their own shape."
          value={block.height === undefined ? '' : String(block.height)}
          check={checkHeight}
          onChange={(height) => onChange(withOptional(block, 'height', height))}
          input={{ type: 'number', inputMode: 'numeric', min, max, className: 'w-40' }}
        />
      )}
    </div>
  );
}
