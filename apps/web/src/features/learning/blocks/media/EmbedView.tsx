import { EMBED_ALLOW, toEmbed, type EmbedBlock } from '@carehub/learning';
import { cn } from '@carehub/ui';
import { CantPlay } from './Transcript';
import type { ViewProps } from './view-props';

/** Forms and documents without a height set. */
const DEFAULT_HEIGHT = 480;

/**
 * A page from an allow-listed site in a sandboxed frame (videos keep 16:9; forms and documents use the block's
 * height), with a link to open it in a new tab. Anything off the allow-list is a plain note, never a frame.
 */
export function EmbedView({ block }: ViewProps<EmbedBlock>) {
  const check = toEmbed(block.url);
  if (!check.ok) return <CantPlay reason={`This can't be shown here. ${check.reason}`} />;
  const { embed } = check;
  return (
    <figure className="flex flex-col gap-2">
      <iframe
        src={embed.embedUrl}
        title={block.title}
        sandbox={embed.sandbox}
        allow={EMBED_ALLOW}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        className={cn(
          'w-full rounded border border-border',
          embed.kind === 'video' && 'aspect-video',
        )}
        style={embed.kind === 'video' ? undefined : { height: block.height ?? DEFAULT_HEIGHT }}
      />
      <figcaption className="flex flex-wrap justify-between gap-2 text-small text-muted">
        <span>{block.title}</span>
        <a href={block.url} target="_blank" rel="noopener noreferrer" className="underline">
          Open in a new tab<span className="sr-only"> ({embed.providerName})</span>
        </a>
      </figcaption>
    </figure>
  );
}
