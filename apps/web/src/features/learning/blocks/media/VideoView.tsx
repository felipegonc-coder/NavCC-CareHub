import { EMBED_ALLOW, mediaSource, type VideoBlock } from '@carehub/learning';
import { useId, useState } from 'react';
import { mediaUrl } from '../../media';
import { CantPlay, Transcript } from './Transcript';
import type { ViewProps } from './view-props';

const NOT_PLAYED = "This video can't be played here.";

/** "es-MX" → "Spanish (Mexico)", for caption tracks without a label. */
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/**
 * A video block: an uploaded video with its captions as tracks (turned on from the player's controls), a video
 * site in an allow-listed frame, or a plain note when it can't be played; then its transcript, if any.
 */
export function VideoView({ block, course, go }: ViewProps<VideoBlock>) {
  const titleId = useId();
  const [failed, setFailed] = useState<string>();
  const source = mediaSource(block.media, 'video');
  const link = block.media.kind === 'url' ? block.media.url : undefined;
  const src = source.kind === 'file' ? mediaUrl(block.media) : undefined;

  let player;
  if (source.kind === 'embed') {
    player = (
      <iframe
        src={source.embed.embedUrl}
        title={block.title}
        sandbox={source.embed.sandbox}
        allow={EMBED_ALLOW}
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        className="aspect-video w-full rounded border border-border"
      />
    );
  } else if (source.kind === 'refused') {
    player = <CantPlay reason={`${NOT_PLAYED} ${source.reason}`} href={link} />;
  } else if (!src || failed === src) {
    player = <CantPlay reason={NOT_PLAYED} href={link} />;
  } else {
    player = (
      // Captions come from the block's caption files; videos without them get a transcript instead.
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={src}
        controls
        preload="metadata"
        playsInline
        aria-labelledby={titleId}
        onError={() => setFailed(src)}
        className="aspect-video w-full rounded bg-fill"
      >
        {block.captions?.map((captions) => (
          <track
            key={captions.fileId}
            kind="captions"
            src={mediaUrl({ kind: 'file', fileId: captions.fileId })}
            srcLang={captions.language}
            label={captions.label ?? languageName(captions.language)}
          />
        ))}
      </video>
    );
  }

  return (
    <figure className="flex flex-col gap-3">
      <figcaption id={titleId} className="font-semibold">
        {block.title}
      </figcaption>
      {player}
      <Transcript text={block.transcript} course={course} go={go} />
    </figure>
  );
}
