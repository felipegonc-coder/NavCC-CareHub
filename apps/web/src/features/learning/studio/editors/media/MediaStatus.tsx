import { mediaSource, type MediaRef } from '@carehub/learning';

/** What a video or audio block plays, or why it can't (such as a link to a media file on another site). */
export function MediaStatus({ media, use }: { media: MediaRef; use: 'video' | 'audio' }) {
  const source = mediaSource(media, use);
  if (source.kind === 'refused')
    return (
      <p role="alert" className="text-small text-danger">
        {source.reason}
      </p>
    );
  return (
    <p className="text-small text-muted">
      {source.kind === 'embed'
        ? `Plays from ${source.embed.providerName}.`
        : `Plays the uploaded ${use === 'video' ? 'video' : 'audio file'}.`}
    </p>
  );
}
