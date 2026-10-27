import { cn, colorClasses, colorNames, coverGradients, coverNames } from '@carehub/ui';

function label(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The picked colours as tags and as text, and the preset covers. */
export function PaletteSwatches() {
  return (
    <>
      <ul aria-label="Colours as tags" className="flex flex-wrap gap-2 text-small">
        {colorNames.map((name) => (
          <li
            key={name}
            className={cn('rounded px-1.5', colorClasses[name].bg, colorClasses[name].text)}
          >
            {label(name)}
          </li>
        ))}
      </ul>
      <ul aria-label="Colours as text" className="flex flex-wrap gap-x-3 gap-y-1 text-small">
        {colorNames.map((name) => (
          <li key={name} className={colorClasses[name].text}>
            {label(name)}
          </li>
        ))}
      </ul>
      <ul aria-label="Covers" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {coverNames.map((name) => (
          <li key={name} className="flex flex-col gap-1 text-small">
            <span
              aria-hidden
              className="h-12 rounded"
              style={{ backgroundImage: coverGradients[name] }}
            />
            {label(name)}
          </li>
        ))}
      </ul>
    </>
  );
}
