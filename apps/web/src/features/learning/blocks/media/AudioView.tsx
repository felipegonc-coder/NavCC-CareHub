import { mediaSource, type AudioBlock } from '@carehub/learning';
import { useId, useState } from 'react';
import { mediaUrl } from '../../media';
import { CantPlay, Transcript } from './Transcript';
import type { ViewProps } from './view-props';

const NOT_PLAYED = "This audio can't be played here.";

/** An audio block: its title, the player (or a plain note when it can't be played) and its transcript. */
export function AudioView({ block, course, go }: ViewProps<AudioBlock>) {
  const titleId = useId();
  const [failed, setFailed] = useState<string>();
  const source = mediaSource(block.media, 'audio');
  const link = block.media.kind === 'url' ? block.media.url : undefined;
  const src = source.kind === 'file' ? mediaUrl(block.media) : undefined;

  return (
    <figure className="flex flex-col gap-3">
      <figcaption id={titleId} className="font-semibold">
        {block.title}
      </figcaption>
      {source.kind === 'refused' ? (
        <CantPlay reason={`${NOT_PLAYED} ${source.reason}`} href={link} />
      ) : !src || failed === src ? (
        <CantPlay reason={NOT_PLAYED} href={link} />
      ) : (
        // Audio has a transcript (below) rather than captions.
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio
          src={src}
          controls
          preload="metadata"
          aria-labelledby={titleId}
          onError={() => setFailed(src)}
          className="w-full"
        />
      )}
      <Transcript text={block.transcript} course={course} go={go} />
    </figure>
  );
}
