import {
  PLAYER_TEXT_SIZE_KEY,
  parsePlayerTextSize,
  playerTextSizeLabel,
  stepPlayerTextSize,
  type PlayerTextSize,
} from '@carehub/learning';
import { Button } from '@carehub/ui';
import { Minus, Plus } from 'lucide-react';
import { useCallback, useId, useState } from 'react';

function rememberedSize(): PlayerTextSize {
  try {
    return parsePlayerTextSize(window.localStorage.getItem(PLAYER_TEXT_SIZE_KEY));
  } catch {
    return 'standard'; // Storage is blocked.
  }
}

/** The learner's text size for lessons, remembered on this device. */
export function usePlayerTextSize() {
  const [size, setSize] = useState(rememberedSize);
  const change = useCallback((next: PlayerTextSize) => {
    setSize(next);
    try {
      window.localStorage.setItem(PLAYER_TEXT_SIZE_KEY, next);
    } catch {
      // Storage is blocked, so the size holds for this visit only.
    }
  }, []);
  return [size, change] as const;
}

type TextSizeControlProps = { size: PlayerTextSize; onChange(size: PlayerTextSize): void };

/** Smaller and Bigger, with the size between them, read out as it changes. */
export function TextSizeControl({ size, onChange }: TextSizeControlProps) {
  const labelId = useId();
  const smaller = stepPlayerTextSize(size, -1);
  const bigger = stepPlayerTextSize(size, 1);
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-2">
      <span id={labelId} className="text-small font-medium">
        Text size
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={!smaller}
        onClick={() => smaller && onChange(smaller)}
      >
        <Minus aria-hidden />
        Smaller
      </Button>
      <span role="status" className="min-w-20 text-center text-small">
        {playerTextSizeLabel(size)}
      </span>
      <Button
        variant="secondary"
        size="sm"
        disabled={!bigger}
        onClick={() => bigger && onChange(bigger)}
      >
        <Plus aria-hidden />
        Bigger
      </Button>
    </div>
  );
}
