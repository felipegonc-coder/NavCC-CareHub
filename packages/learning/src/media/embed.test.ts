import { describe, expect, it } from 'vitest';
import {
  EMBED_ALLOW,
  EMBED_FORM_SANDBOX,
  EMBED_FRAME_ORIGINS,
  EMBED_PROVIDERS,
  EMBED_SANDBOX,
  mediaSource,
  toEmbed,
} from './embed';

const embedUrl = (input: string) => {
  const result = toEmbed(input);
  return result.ok ? result.embed.embedUrl : `refused: ${result.reason}`;
};
const YT = 'dQw4w9WgXcQ';
const DOC = '1AbCdEfGhIjKlMnOpQrStUv';

/** Links that must turn into these embed addresses. */
const allowed: [string, string][] = [
  [`https://www.youtube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
  [`https://youtu.be/${YT}?t=1m30s`, `https://www.youtube-nocookie.com/embed/${YT}?start=90`],
  [
    `https://m.youtube.com/watch?v=${YT}&t=45`,
    `https://www.youtube-nocookie.com/embed/${YT}?start=45`,
  ],
  [`https://www.youtube.com/shorts/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
  [
    `https://www.youtube-nocookie.com/embed/${YT}?start=30`,
    `https://www.youtube-nocookie.com/embed/${YT}?start=30`,
  ],
  [
    'https://www.youtube.com/playlist?list=PLabc123_-',
    'https://www.youtube-nocookie.com/embed/videoseries?list=PLabc123_-',
  ],
  [`youtube.com/watch?v=${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
  ['https://vimeo.com/123456789', 'https://player.vimeo.com/video/123456789?dnt=1'],
  [
    'https://vimeo.com/123456789/abcdef1234',
    'https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234',
  ],
  [
    'https://player.vimeo.com/video/123456789?h=abcdef1234',
    'https://player.vimeo.com/video/123456789?dnt=1&h=abcdef1234',
  ],
  [
    'https://vimeo.com/channels/staffpicks/123456789',
    'https://player.vimeo.com/video/123456789?dnt=1',
  ],
  [
    'https://www.loom.com/share/0123456789abcdef0123456789abcdef?sid=1',
    'https://www.loom.com/embed/0123456789abcdef0123456789abcdef',
  ],
  [
    'https://carehub.wistia.com/medias/abcde12345',
    'https://fast.wistia.net/embed/iframe/abcde12345',
  ],
  [
    'https://fast.wistia.net/embed/iframe/abcde12345?videoFoam=true',
    'https://fast.wistia.net/embed/iframe/abcde12345',
  ],
  [
    'https://docs.google.com/forms/d/e/1FAIpQLSdExample_Form-Id1234/viewform?usp=sf_link',
    'https://docs.google.com/forms/d/e/1FAIpQLSdExample_Form-Id1234/viewform?embedded=true',
  ],
  [
    `https://docs.google.com/forms/d/${DOC}/viewform`,
    `https://docs.google.com/forms/d/${DOC}/viewform?embedded=true`,
  ],
  [
    `https://docs.google.com/document/d/${DOC}/edit?usp=sharing`,
    `https://docs.google.com/document/d/${DOC}/preview`,
  ],
  [
    `https://docs.google.com/document/u/1/d/${DOC}/edit`,
    `https://docs.google.com/document/d/${DOC}/preview`,
  ],
  [
    'https://docs.google.com/document/d/e/2PACX-1vExample/pub',
    'https://docs.google.com/document/d/e/2PACX-1vExample/pub?embedded=true',
  ],
  [
    `https://docs.google.com/spreadsheets/d/${DOC}/edit#gid=0`,
    `https://docs.google.com/spreadsheets/d/${DOC}/preview`,
  ],
  [
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vExample/pubhtml',
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vExample/pubhtml?widget=true&headers=false',
  ],
  [
    `https://docs.google.com/presentation/d/${DOC}/edit#slide=id.p`,
    `https://docs.google.com/presentation/d/${DOC}/embed`,
  ],
  [
    `https://drive.google.com/file/d/${DOC}/view?usp=sharing`,
    `https://drive.google.com/file/d/${DOC}/preview`,
  ],
  [`https://drive.google.com/open?id=${DOC}`, `https://drive.google.com/file/d/${DOC}/preview`],
  [
    'https://forms.office.com/Pages/ResponsePage.aspx?id=AbC123_-xyz',
    'https://forms.office.com/Pages/ResponsePage.aspx?id=AbC123_-xyz&embed=true',
  ],
  [
    'https://forms.microsoft.com/pages/responsepage.aspx?id=AbC123',
    'https://forms.office.com/Pages/ResponsePage.aspx?id=AbC123&embed=true',
  ],
  ['https://carehub.typeform.com/to/AbCd1234', 'https://form.typeform.com/to/AbCd1234'],
  ['https://form.jotform.com/231234567890', 'https://form.jotform.com/231234567890'],
  ['https://www.jotform.com/form/231234567890', 'https://form.jotform.com/231234567890'],
  ['https://airtable.com/shrAbCdEfGhIjKlMn', 'https://airtable.com/embed/shrAbCdEfGhIjKlMn'],
  [
    'https://airtable.com/appAbCdEfGhIjKl/shrAbCdEfGhIjKlMn',
    'https://airtable.com/embed/appAbCdEfGhIjKl/shrAbCdEfGhIjKlMn',
  ],
  [
    'https://www.figma.com/design/AbCdEfGhIjKlMnOp/Ward-plan?node-id=1-2&t=xyz',
    'https://www.figma.com/embed?embed_host=carehub&url=https%3A%2F%2Fwww.figma.com%2Fdesign%2FAbCdEfGhIjKlMnOp%3Fnode-id%3D1-2',
  ],
  ['https://miro.com/app/board/uXjVOAbCdEf=/', 'https://miro.com/app/live-embed/uXjVOAbCdEf=/'],
  [
    'https://www.canva.com/design/DAFAbCdEfGh/AbCdEfGhIjKlMn/view',
    'https://www.canva.com/design/DAFAbCdEfGh/AbCdEfGhIjKlMn/view?embed',
  ],
];

describe('toEmbed', () => {
  it('turns links from allowed sites into their embed address', () => {
    for (const [input, expected] of allowed) expect(embedUrl(input)).toBe(expected);
  });

  it('only ever embeds from the frame origins the server allows', () => {
    for (const [input] of allowed) {
      const result = toEmbed(input);
      if (!result.ok) throw new Error(`refused ${input}`);
      const origin = /^https:\/\/[^/?#]+/.exec(result.embed.embedUrl)?.[0] ?? '';
      expect(EMBED_FRAME_ORIGINS).toContain(origin);
    }
  });

  it('names the provider and the kind', () => {
    expect(toEmbed(`https://youtu.be/${YT}`)).toEqual({
      ok: true,
      embed: {
        provider: 'youtube',
        providerName: 'YouTube',
        kind: 'video',
        embedUrl: `https://www.youtube-nocookie.com/embed/${YT}`,
        sandbox: EMBED_SANDBOX,
      },
    });
    expect(EMBED_PROVIDERS.map((p) => `${p.id}:${p.kind}`)).toEqual([
      'youtube:video',
      'vimeo:video',
      'loom:video',
      'wistia:video',
      'google_forms:form',
      'google_docs:document',
      'google_drive:document',
      'microsoft_forms:form',
      'typeform:form',
      'jotform:form',
      'airtable:form',
      'figma:document',
      'miro:document',
      'canva:document',
    ]);
  });

  it('accepts a pasted embed code', () => {
    const code = `<iframe width="560" height="315" src="https://www.youtube.com/embed/${YT}?si=abc&amp;start=10" title="YouTube video player" allowfullscreen></iframe>`;
    expect(embedUrl(code)).toBe(`https://www.youtube-nocookie.com/embed/${YT}?start=10`);
  });

  it("refuses links that aren't safe or aren't on the allow-list, with a plain reason", () => {
    expect(embedUrl(`http://www.youtube.com/watch?v=${YT}`)).toBe(
      'refused: Only secure links (starting with https://) can be embedded.',
    );
    expect(embedUrl(`https://user:secret@www.youtube.com/watch?v=${YT}`)).toBe(
      "refused: Links with a user name or password can't be embedded.",
    );
    expect(embedUrl('javascript:alert(1)')).toBe(
      "refused: This isn't a web address. Paste a full link that starts with https://.",
    );
    expect(embedUrl('ward tour video')).toBe(
      "refused: This isn't a web address. Paste a full link that starts with https://.",
    );
    expect(embedUrl('https://example.com/page')).toBe(
      "refused: Pages from example.com can't be embedded. You can embed videos (YouTube, Vimeo, Loom, Wistia), forms (Google Forms, Microsoft Forms, Typeform, Jotform, Airtable) and documents (Google Docs, Sheets and Slides, Google Drive, Figma, Miro, Canva). To point to another site, use a button.",
    );
    expect(embedUrl(`https://youtube.com.example.com/watch?v=${YT}`)).toMatch(
      /^refused: Pages from youtube\.com\.example\.com/,
    );
    expect(embedUrl(`https://notyoutube.com/watch?v=${YT}`)).toMatch(
      /^refused: Pages from notyoutube\.com/,
    );
  });

  it('explains what to copy instead for known sites', () => {
    expect(embedUrl('https://www.youtube.com/@carehub')).toBe(
      "refused: This YouTube link isn't a video. Open the video and copy its address, or use Share.",
    );
    expect(embedUrl('https://vimeo.com/carehub')).toMatch(
      /^refused: This Vimeo link isn't a video/,
    );
    expect(embedUrl(`https://docs.google.com/forms/d/${DOC}/edit`)).toMatch(
      /^refused: This is the form's edit link\. .*Send/,
    );
    expect(embedUrl('https://forms.gle/AbC123')).toMatch(
      /^refused: Short forms\.gle links can't be embedded/,
    );
    expect(embedUrl('https://forms.office.com/r/AbC123')).toMatch(
      /^refused: Short Microsoft Forms links can't be embedded/,
    );
    expect(embedUrl('https://docs.google.com/document/create')).toBe(
      "refused: This Google Docs, Sheets and Slides link can't be embedded. Open the page you want to show and copy its address.",
    );
    expect(embedUrl('https://drive.google.com/drive/folders/1AbCdEfGhIjK')).toMatch(
      /^refused: This Google Drive link can't be embedded/,
    );
  });

  it('sandboxes frames without letting them navigate Care Hub, and lets only forms submit', () => {
    expect(EMBED_SANDBOX).toBe(
      'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation',
    );
    expect(EMBED_FORM_SANDBOX).toBe(`${EMBED_SANDBOX} allow-forms`);
    expect(EMBED_ALLOW).toBe('fullscreen; picture-in-picture; encrypted-media');
    for (const [input] of allowed) {
      const result = toEmbed(input);
      if (!result.ok) throw new Error(`refused ${input}`);
      const { kind, sandbox } = result.embed;
      expect({ input, sandbox }).toEqual({
        input,
        sandbox: kind === 'form' ? EMBED_FORM_SANDBOX : EMBED_SANDBOX,
      });
    }
  });

  it('lists frame origins as https hosts, with a leading "*." as the only wildcard', () => {
    for (const origin of EMBED_FRAME_ORIGINS) {
      expect(origin).toMatch(/^https:\/\/(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/);
    }
  });

  it('matches hosts exactly', () => {
    for (const input of [
      `https://www.youtube.com.example.net/watch?v=${YT}`,
      `https://www.youtube.com@example.net/watch?v=${YT}`,
      `https://example.net/www.youtube.com/watch?v=${YT}`,
      `https://notyoutube.com/watch?v=${YT}`,
      `https://example.net/?next=https://www.youtube.com/watch?v=${YT}`,
    ]) {
      expect({ input, ok: toEmbed(input).ok }).toEqual({ input, ok: false });
    }
  });
});

describe('mediaSource', () => {
  it('plays uploads, video sites and direct media links', () => {
    expect(mediaSource({ kind: 'file', fileId: 'file_1' }, 'video')).toEqual({
      kind: 'file',
      fileId: 'file_1',
    });
    expect(mediaSource({ kind: 'url', url: `https://youtu.be/${YT}` }, 'video')).toMatchObject({
      kind: 'embed',
      embed: { provider: 'youtube', embedUrl: `https://www.youtube-nocookie.com/embed/${YT}` },
    });
    expect(
      mediaSource({ kind: 'url', url: 'https://media.example.org/tour.MP4' }, 'video'),
    ).toEqual({
      kind: 'link',
      url: 'https://media.example.org/tour.MP4',
    });
    expect(
      mediaSource({ kind: 'url', url: 'https://media.example.org/talk.mp3?sig=1' }, 'audio'),
    ).toEqual({
      kind: 'link',
      url: 'https://media.example.org/talk.mp3?sig=1',
    });
  });

  it('refuses everything else with a plain reason', () => {
    expect(mediaSource({ kind: 'url', url: 'https://www.youtube.com/@carehub' }, 'video')).toEqual({
      kind: 'refused',
      reason: "This YouTube link isn't a video. Open the video and copy its address, or use Share.",
    });
    expect(
      mediaSource({ kind: 'url', url: `https://docs.google.com/document/d/${DOC}/edit` }, 'video'),
    ).toEqual({
      kind: 'refused',
      reason:
        "This link isn't a video Care Hub can play. Use a link from YouTube, Vimeo, Loom, Wistia, a link to an MP4 or WebM file, or upload the video.",
    });
    expect(mediaSource({ kind: 'url', url: `https://youtu.be/${YT}` }, 'audio')).toEqual({
      kind: 'refused',
      reason: "This link isn't an audio file. Link to an MP3, M4A, WAV or OGG file, or upload it.",
    });
    expect(
      mediaSource({ kind: 'url', url: 'https://media.example.org/talk.mp3' }, 'video'),
    ).toMatchObject({
      kind: 'refused',
    });
  });
});
