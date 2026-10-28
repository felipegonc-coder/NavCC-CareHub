import { Button, Field, Switch } from '@carehub/ui';
import { useState } from 'react';
import { ShortcutsHelp } from './ShortcutsHelp';

/**
 * Calendar settings → Single-key shortcuts: the switch, saved per person by the settings form
 * (`onChange` with the new value), and the list of every Calendar key.
 */
export function ShortcutsSetting({
  on,
  onChange,
  disabled = false,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** While the settings load. */
  disabled?: boolean;
}) {
  const [help, setHelp] = useState(false);
  return (
    <div className="flex flex-col items-start gap-1">
      <Field
        label="Single-key shortcuts"
        hint="T, D, W, M, J, K, C and more. Never while you type in a field."
        layout="inline"
      >
        <Switch checked={on} onCheckedChange={onChange} disabled={disabled} />
      </Field>
      <Button variant="ghost" size="sm" onClick={() => setHelp(true)}>
        See all shortcuts
      </Button>
      <ShortcutsHelp open={help} onOpenChange={setHelp} on={on} />
    </div>
  );
}
