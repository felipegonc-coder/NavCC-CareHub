import type { MediaRef } from '../format/index';

/** What an embedded page is. Videos keep a 16:9 shape; forms and documents use the block's height. */
export type EmbedKind = 'video' | 'form' | 'document';

/**
 * An allowed embed: always a canonical https address on one of `EMBED_FRAME_ORIGINS`, shown in an iframe with
 * this `sandbox` and `allow={EMBED_ALLOW}`.
 */
export type EmbedTarget = {
  provider: string;
  providerName: string;
  kind: EmbedKind;
  embedUrl: string;
  sandbox: string;
};
export type EmbedCheck = { ok: true; embed: EmbedTarget } | { ok: false; reason: string };

type WebUrl = {
  protocol: string;
  hostname: string;
  pathname: string;
  username: string;
  password: string;
  searchParams: { get(name: string): string | null };
};
// The WHATWG URL parser exists in browsers and Node; typed locally so this package needs no DOM or Node types.
const UrlParser = (globalThis as unknown as { URL: new (input: string) => WebUrl }).URL;

// An embed address; a plain reason; null for "this site, but not a page that can be embedded"; undefined for
// "another provider on the same host" (Google Forms and Docs share docs.google.com).
type Match = string | { reason: string } | null | undefined;
type Provider = {
  id: string;
  name: string;
  kind: EmbedKind;
  hosts: RegExp;
  match(url: WebUrl, path: string[]): Match;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const GOOGLE_ID = /^[A-Za-z0-9_-]{10,}$/;

/** "1h2m3s", "93s" or "93" in seconds. */
function seconds(value: string | null): number {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value ?? '');
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

function youtube(url: WebUrl, path: string[]): Match {
  const list = url.searchParams.get('list');
  const short = url.hostname === 'youtu.be';
  const id = short
    ? path[0]
    : path[0] === 'watch'
      ? url.searchParams.get('v')
      : ['embed', 'shorts', 'live', 'v'].includes(path[0] ?? '')
        ? path[1]
        : null;
  const start = seconds(url.searchParams.get('t') ?? url.searchParams.get('start'));
  if (id && YOUTUBE_ID.test(id))
    return `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ''}`;
  if (path[0] === 'playlist' && list && /^[A-Za-z0-9_-]+$/.test(list))
    return `https://www.youtube-nocookie.com/embed/videoseries?list=${list}`;
  return {
    reason: "This YouTube link isn't a video. Open the video and copy its address, or use Share.",
  };
}

function vimeo(url: WebUrl, path: string[]): Match {
  const at = path.includes('video')
    ? path.indexOf('video') + 1
    : path.findIndex((part) => /^\d+$/.test(part));
  if (!/^\d+$/.test(path[at] ?? ''))
    return { reason: "This Vimeo link isn't a video. Open the video and copy its address." };
  const hash =
    url.searchParams.get('h') ?? (url.hostname === 'player.vimeo.com' ? null : path[at + 1]);
  const unlisted = hash && /^[0-9a-f]{6,20}$/.test(hash) ? `&h=${hash}` : '';
  return `https://player.vimeo.com/video/${path[at]}?dnt=1${unlisted}`;
}

function google(url: WebUrl, signedInPath: string[]): Match {
  const path =
    signedInPath[1] === 'u' ? [signedInPath[0] ?? '', ...signedInPath.slice(3)] : signedInPath; // "/document/u/1/d/…"
  const [app, d, first, second, action] = path;
  if (d !== 'd') return null;
  const published = first === 'e';
  const id = published ? second : first;
  if (!id || !GOOGLE_ID.test(id)) return null;
  const base = `https://docs.google.com/${app}/d/${published ? 'e/' : ''}${id}`;
  if (app === 'forms') {
    if (!published && action !== 'viewform' && path[3] !== 'viewform') {
      return {
        reason:
          "This is the form's edit link. In Google Forms, choose Send, copy the link and paste it here.",
      };
    }
    return `${base}/viewform?embedded=true`;
  }
  if (app === 'document') return published ? `${base}/pub?embedded=true` : `${base}/preview`;
  if (app === 'spreadsheets')
    return published ? `${base}/pubhtml?widget=true&headers=false` : `${base}/preview`;
  if (app === 'presentation') return `${base}/embed`;
  return null;
}

const PROVIDERS: Provider[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    kind: 'video',
    hosts: /^((www|m)\.)?(youtube\.com|youtube-nocookie\.com)$|^youtu\.be$/,
    match: youtube,
  },
  {
    id: 'vimeo',
    name: 'Vimeo',
    kind: 'video',
    hosts: /^(www\.|player\.)?vimeo\.com$/,
    match: vimeo,
  },
  {
    id: 'loom',
    name: 'Loom',
    kind: 'video',
    hosts: /^(www\.)?loom\.com$/,
    match: (_, [kind, id]) =>
      ['share', 'embed'].includes(kind ?? '') && id && /^[0-9a-f]{32}$/.test(id)
        ? `https://www.loom.com/embed/${id}`
        : null,
  },
  {
    id: 'wistia',
    name: 'Wistia',
    kind: 'video',
    hosts: /^([a-z0-9-]+\.)?wistia\.(com|net)$/,
    match: (_, path) => {
      const at = path.indexOf('medias');
      const id = at >= 0 ? path[at + 1] : path[1] === 'iframe' ? path[2] : undefined;
      return id && /^[a-z0-9]{10}$/i.test(id) ? `https://fast.wistia.net/embed/iframe/${id}` : null;
    },
  },
  {
    id: 'google_forms',
    name: 'Google Forms',
    kind: 'form',
    hosts: /^docs\.google\.com$/,
    match: (url, path) => (path[0] === 'forms' ? google(url, path) : undefined),
  },
  {
    id: 'google_docs',
    name: 'Google Docs, Sheets and Slides',
    kind: 'document',
    hosts: /^docs\.google\.com$/,
    match: (url, path) => (path[0] !== 'forms' ? google(url, path) : undefined),
  },
  {
    id: 'google_drive',
    name: 'Google Drive',
    kind: 'document',
    hosts: /^drive\.google\.com$/,
    match: (url, path) => {
      const id =
        path[0] === 'file' && path[1] === 'd'
          ? path[2]
          : path[0] === 'open'
            ? url.searchParams.get('id')
            : null;
      return id && GOOGLE_ID.test(id) ? `https://drive.google.com/file/d/${id}/preview` : null;
    },
  },
  {
    id: 'microsoft_forms',
    name: 'Microsoft Forms',
    kind: 'form',
    hosts: /^forms\.(office|microsoft)\.com$/,
    match: (url, path) => {
      const id = url.searchParams.get('id');
      if (path[0] === 'r')
        return {
          reason:
            "Short Microsoft Forms links can't be embedded. In Microsoft Forms, choose Collect responses, then Embed, and paste that code here.",
        };
      return path.join('/').toLowerCase() === 'pages/responsepage.aspx' &&
        id &&
        /^[A-Za-z0-9_-]+$/.test(id)
        ? `https://forms.office.com/Pages/ResponsePage.aspx?id=${id}&embed=true`
        : null;
    },
  },
  {
    id: 'typeform',
    name: 'Typeform',
    kind: 'form',
    hosts: /^([a-z0-9-]+\.)?typeform\.com$/,
    match: (_, [to, id]) =>
      to === 'to' && id && /^[A-Za-z0-9]{4,}$/.test(id)
        ? `https://form.typeform.com/to/${id}`
        : null,
  },
  {
    id: 'jotform',
    name: 'Jotform',
    kind: 'form',
    hosts: /^([a-z0-9-]+\.)?jotform\.com$/,
    match: (_, path) => {
      const id = path[0] === 'form' ? path[1] : path[0];
      return id && /^\d{6,}$/.test(id) ? `https://form.jotform.com/${id}` : null;
    },
  },
  {
    id: 'airtable',
    name: 'Airtable',
    kind: 'form',
    hosts: /^airtable\.com$/,
    match: (_, path) => {
      const parts = path[0] === 'embed' ? path.slice(1) : path;
      const at = parts.findIndex((part) => /^shr[A-Za-z0-9]{10,}$/.test(part));
      const app = at === 1 && /^app[A-Za-z0-9]{10,}$/.test(parts[0] ?? '') ? `${parts[0]}/` : '';
      return at === 0 || app ? `https://airtable.com/embed/${app}${parts[at]}` : null;
    },
  },
  {
    id: 'figma',
    name: 'Figma',
    kind: 'document',
    hosts: /^(www\.)?figma\.com$/,
    match: (url, [kind, key]) => {
      if (
        !['file', 'design', 'proto', 'board', 'slides', 'deck'].includes(kind ?? '') ||
        !key ||
        !/^[A-Za-z0-9]{10,}$/.test(key)
      )
        return null;
      const node = url.searchParams.get('node-id');
      const page = `https://www.figma.com/${kind}/${key}${node && /^[0-9:-]+$/.test(node) ? `?node-id=${node}` : ''}`;
      return `https://www.figma.com/embed?embed_host=carehub&url=${encodeURIComponent(page)}`;
    },
  },
  {
    id: 'miro',
    name: 'Miro',
    kind: 'document',
    hosts: /^miro\.com$/,
    match: (_, [app, board, id]) =>
      app === 'app' && board === 'board' && id && /^[A-Za-z0-9_=-]+$/.test(id)
        ? `https://miro.com/app/live-embed/${id}/`
        : null,
  },
  {
    id: 'canva',
    name: 'Canva',
    kind: 'document',
    hosts: /^(www\.)?canva\.com$/,
    match: (_, [design, id, token]) =>
      design === 'design' &&
      id &&
      token &&
      /^[A-Za-z0-9_-]+$/.test(id) &&
      /^[A-Za-z0-9_-]+$/.test(token)
        ? `https://www.canva.com/design/${id}/${token}/view?embed`
        : null,
  },
];

/** The sites people can embed, for help text in the editor. */
export const EMBED_PROVIDERS: readonly { id: string; name: string; kind: EmbedKind }[] =
  PROVIDERS.map(({ id, name, kind }) => ({ id, name, kind }));

/** Every origin an embed address can have, for the server's frame-src Content Security Policy. */
export const EMBED_FRAME_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.loom.com',
  'https://fast.wistia.net',
  'https://docs.google.com',
  'https://drive.google.com',
  'https://forms.office.com',
  'https://form.typeform.com',
  'https://form.jotform.com',
  'https://airtable.com',
  'https://www.figma.com',
  'https://miro.com',
  'https://www.canva.com',
] as const;

/**
 * Sandbox for embed frames: the embedded site may run as itself (it's always another origin, never Care Hub or an
 * uploaded file), but can't navigate Care Hub. Only forms may also submit forms.
 */
export const EMBED_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';
export const EMBED_FORM_SANDBOX = `${EMBED_SANDBOX} allow-forms`;
/** The iframe `allow` attribute for embeds. */
export const EMBED_ALLOW = 'fullscreen; picture-in-picture; encrypted-media';

const names = (kind: EmbedKind) =>
  PROVIDERS.filter((p) => p.kind === kind)
    .map((p) => p.name)
    .join(', ');

type Checked = EmbedCheck | { ok: false; reason: string; provider: Provider };

function checkEmbed(input: string): Checked {
  const pasted = /^\s*<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i.exec(input)?.[1];
  let address = (pasted ?? input).trim().replace(/&amp;/g, '&');
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(address)) address = `https://${address}`; // "youtube.com/watch?v=…"
  const notAddress = "This isn't a web address. Paste a full link that starts with https://.";
  let url: WebUrl;
  try {
    url = new UrlParser(address);
  } catch {
    return { ok: false, reason: notAddress };
  }
  if (url.protocol === 'http:')
    return { ok: false, reason: 'Only secure links (starting with https://) can be embedded.' };
  if (url.protocol !== 'https:') return { ok: false, reason: notAddress };
  if (url.username || url.password)
    return { ok: false, reason: "Links with a user name or password can't be embedded." };
  if (url.hostname === 'forms.gle') {
    return {
      ok: false,
      reason:
        "Short forms.gle links can't be embedded. Open the link and copy the full address from the browser.",
    };
  }
  const path = url.pathname.split('/').filter(Boolean);
  let refused: { reason: string; provider: Provider } | undefined;
  for (const provider of PROVIDERS) {
    if (!provider.hosts.test(url.hostname)) continue;
    const found = provider.match(url, path);
    if (found === undefined) continue;
    if (typeof found === 'string') {
      return {
        ok: true,
        embed: {
          provider: provider.id,
          providerName: provider.name,
          kind: provider.kind,
          embedUrl: found,
          sandbox: provider.kind === 'form' ? EMBED_FORM_SANDBOX : EMBED_SANDBOX,
        },
      };
    }
    const reason =
      found?.reason ??
      `This ${provider.name} link can't be embedded. Open the page you want to show and copy its address.`;
    refused ??= { reason, provider };
  }
  if (refused) return { ok: false, ...refused };
  return {
    ok: false,
    reason: `Pages from ${url.hostname} can't be embedded. You can embed videos (${names('video')}), forms (${names('form')}) and documents (${names('document')}). To point to another site, use a button.`,
  };
}

/**
 * Checks a link (or a pasted embed code) against the embed allow-list. Known video, form and document sites are
 * turned into their embed address; anything else is refused with a plain reason. Https only.
 */
export function toEmbed(input: string): EmbedCheck {
  const checked = checkEmbed(input);
  return checked.ok ? checked : { ok: false, reason: checked.reason };
}

/** How a video or audio block plays its media. */
export type MediaSource =
  | { kind: 'file'; fileId: string } // uploaded to Care Hub
  | { kind: 'link'; url: string } // a direct https link to a media file
  | { kind: 'embed'; embed: EmbedTarget } // a video site, in a frame
  | { kind: 'refused'; reason: string };

/**
 * How to play a video or audio block's media. Links to video sites become embeds (allow-list); other links play
 * directly only when they point to a media file; anything else is refused with a plain reason.
 */
export function mediaSource(media: MediaRef, use: 'video' | 'audio'): MediaSource {
  if (media.kind === 'file') return { kind: 'file', fileId: media.fileId };
  const embed = checkEmbed(media.url);
  if (use === 'video' && embed.ok && embed.embed.kind === 'video')
    return { kind: 'embed', embed: embed.embed };
  let path = '';
  try {
    const url = new UrlParser(media.url);
    if (url.protocol === 'https:') path = url.pathname.toLowerCase();
  } catch {
    // not a link; refused below
  }
  const files =
    use === 'video' ? /\.(mp4|m4v|mov|webm)$/ : /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/;
  if (files.test(path)) return { kind: 'link', url: media.url };
  if (use === 'video' && !embed.ok && 'provider' in embed && embed.provider.kind === 'video')
    return { kind: 'refused', reason: embed.reason };
  const reason =
    use === 'video'
      ? `This link isn't a video Care Hub can play. Use a link from ${names('video')}, a link to an MP4 or WebM file, or upload the video.`
      : "This link isn't an audio file. Link to an MP3, M4A, WAV or OGG file, or upload it.";
  return { kind: 'refused', reason };
}
