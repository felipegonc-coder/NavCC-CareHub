import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from '@carehub/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../../lib/api';
import {
  downloadExport,
  EXPORT_POLL_MS,
  exportPercent,
  fetchExport,
  startExport,
  type ExportView,
} from './api';
import { goTo, printPath, type ExportTarget } from './store';

type Format = 'markdown' | 'html' | 'pdf';

const FORMATS: { value: Format; label: string; hint: string }[] = [
  {
    value: 'markdown',
    label: 'Markdown and CSV',
    hint: 'Pages as Markdown files and databases as CSV, in a zip that opens offline.',
  },
  {
    value: 'html',
    label: 'HTML',
    hint: 'Pages as web pages with their styling, in a zip that opens offline.',
  },
  {
    value: 'pdf',
    label: 'PDF',
    hint: 'Opens the Print view. Choose Save as PDF in the print dialog, where you also pick the paper size and scale.',
  },
];

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

export interface ExportDialogProps {
  target: ExportTarget;
  onClose: () => void;
  /** How often a running export is checked. */
  pollMs?: number;
}

/**
 * Page menu → Export (Import and export spec, section 2): the format and options, then Export.
 * Small exports download at once; bigger ones show "Preparing your export (42%)" and send a 🔔
 * notice when they're ready. PDF opens the Print view, where the browser saves the PDF.
 */
export function ExportDialog({ target, onClose, pollMs = EXPORT_POLL_MS }: ExportDialogProps) {
  const { toast } = useToast();
  const formatName = useId();
  const [format, setFormat] = useState<Format>('markdown');
  const [includeSubpages, setIncludeSubpages] = useState(false);
  const [includeFiles, setIncludeFiles] = useState(true);
  const [databases, setDatabases] = useState<'view' | 'all'>('all');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<ExportView | null>(null);
  const handled = useRef<string | null>(null);

  const followed = useQuery({
    queryKey: ['import-export', 'export', started?.id],
    queryFn: ({ signal }) => fetchExport(started?.id ?? '', signal),
    enabled: started?.status === 'running',
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== 'running' ? false : pollMs,
  });
  const current = followed.data ?? started;

  // Ready: download it once, say so, and close.
  useEffect(() => {
    if (current?.status !== 'ready' || handled.current === current.id) return;
    handled.current = current.id;
    downloadExport(current);
    toast({
      title: 'Your export is ready',
      description: `${current.fileName ?? 'The zip'} is downloading.`,
      variant: 'success',
    });
    onClose();
  }, [current, toast, onClose]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (format === 'pdf') {
      onClose();
      goTo(printPath(target.id, { pdf: true }));
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const view = await startExport({
        pageId: target.id,
        format,
        includeSubpages,
        includeFiles,
        databases,
      });
      setStarted(view);
      if (view.status === 'failed') setError(view.error ?? 'The export stopped. Try again.');
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setStarting(false);
    }
  }

  const running = current?.status === 'running';
  const failed = current?.status === 'failed' || current?.status === 'expired';
  const percent = current ? exportPercent(current) : 0;
  const showDatabases = format !== 'pdf' && (target.kind === 'database' || includeSubpages);

  return (
    <Dialog open onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export</DialogTitle>
          <DialogDescription>{target.title || 'Untitled'}</DialogDescription>
        </DialogHeader>
        {running ? (
          <div className="flex flex-col gap-3">
            <p className="text-body text-fg">Preparing your export ({percent}%)</p>
            <progress
              className="h-2 w-full accent-primary"
              max={100}
              value={percent}
              aria-label="Preparing your export"
            />
            <p className="text-small text-muted">
              You can close this. A 🔔 notice brings the download when it&apos;s ready.
            </p>
            {/* Read out every 25%, not on every check. */}
            <p className="sr-only" aria-live="polite">
              Preparing your export ({Math.floor(percent / 25) * 25}%)
            </p>
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={submit}>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-small font-medium text-fg">Format</legend>
              {FORMATS.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded border border-border p-3 hover:border-border-hover has-[:checked]:border-primary"
                >
                  <input
                    type="radio"
                    name={formatName}
                    value={option.value}
                    checked={format === option.value}
                    onChange={() => setFormat(option.value)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="flex flex-col gap-0.5 text-body font-medium text-fg">
                    {option.label}
                    <span className="text-small font-normal text-muted">{option.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {format !== 'pdf' && (
              <div className="flex flex-col gap-3">
                <Field label="Include sub-pages" layout="inline">
                  <Checkbox
                    checked={includeSubpages}
                    onCheckedChange={(value) => setIncludeSubpages(value === true)}
                  />
                </Field>
                <Field label="Include files and pictures" layout="inline">
                  <Checkbox
                    checked={includeFiles}
                    onCheckedChange={(value) => setIncludeFiles(value === true)}
                  />
                </Field>
              </div>
            )}
            {showDatabases && (
              <Field label="Databases">
                <Select
                  value={databases}
                  onValueChange={(value: string) => setDatabases(value === 'view' ? 'view' : 'all')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="view">This view</SelectItem>
                    <SelectItem value="all">Everything</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
            {(error || failed) && (
              <p role="alert" className="text-small text-danger">
                {error ?? current?.error ?? 'The export stopped. Try again.'}
              </p>
            )}
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={starting}>
                Export
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
