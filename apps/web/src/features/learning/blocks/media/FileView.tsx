import type { FileBlock } from '@carehub/learning';
import { Button, Card } from '@carehub/ui';
import { Download, FileText } from 'lucide-react';
import { mediaUrl } from '../../media';
import type { ViewProps } from './view-props';

/** A file to download: its name, what it is, and a Download button. */
export function FileView({ block }: ViewProps<FileBlock>) {
  const href = `${mediaUrl({ kind: 'file', fileId: block.fileId }) ?? ''}?download=1`;
  return (
    <Card className="flex flex-wrap items-center gap-4">
      <FileText aria-hidden className="size-6 shrink-0 text-muted" />
      <div className="flex min-w-0 grow basis-48 flex-col gap-1">
        <p className="break-words font-semibold">{block.name}</p>
        {block.description && <p className="text-small text-muted">{block.description}</p>}
      </div>
      <Button asChild variant="secondary">
        <a href={href} download>
          <Download aria-hidden />
          Download<span className="sr-only"> {block.name}</span>
        </a>
      </Button>
    </Card>
  );
}
