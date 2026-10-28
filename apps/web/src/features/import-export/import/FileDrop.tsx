import { Button, cn } from '@carehub/ui';
import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';

// Where the file goes on the Import screen: dropped on the area, or picked with "Choose a file"
// (Import and export spec, section 6: drop areas have a button too).

/** "1.5 MB", "820 KB", "12 bytes". */
export function sizeWords(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
}

/** ".md, .txt or .zip" */
export function endingsWords(endings: readonly string[]): string {
  if (endings.length < 2) return endings.join('');
  return `${endings.slice(0, -1).join(', ')} or ${endings.at(-1)}`;
}

export interface FileDropProps {
  /** File name endings the picker offers. */
  accept: readonly string[];
  file: File | null;
  onFile(file: File): void;
  /** The id of the text saying what's wrong with the file, if anything. */
  problemId?: string;
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');

export function FileDrop({ accept, file, onFile, problemId }: FileDropProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setOver(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex flex-col items-center gap-3 rounded border-2 border-dashed p-6 text-center transition-colors',
        over ? 'border-primary bg-fill' : 'border-border',
      )}
    >
      <Upload aria-hidden className="size-6 text-muted" />
      <p className="text-body">
        {file ? (
          <>
            <span className="font-medium">{file.name}</span>
            <span className="text-muted"> · {sizeWords(file.size)}</span>
          </>
        ) : (
          'Drop the file here'
        )}
      </p>
      <Button
        variant="secondary"
        aria-describedby={problemId}
        onClick={() => input.current?.click()}
      >
        {file ? 'Choose another file' : 'Choose a file'}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept.join(',')}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          // Cleared, so picking the same file again still counts.
          event.target.value = '';
          if (picked) onFile(picked);
        }}
      />
      <p className="text-small text-muted">{endingsWords(accept)}</p>
    </div>
  );
}
