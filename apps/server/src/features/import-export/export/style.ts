// The stylesheet inside every exported HTML file. An exported file opens offline, away from the
// app's CSS variables, so the design kit's light values are written out here: colours from
// packages/ui/src/tokens.ts and palette.ts, sizes from scale.ts. Keep them in step with the kit.

const PALETTE: Record<string, { text: string; bg: string }> = {
  gray: { text: '#6F6C68', bg: '#F2F1F0' },
  brown: { text: '#906141', bg: '#F6EEEA' },
  orange: { text: '#AC5209', bg: '#FDEDE0' },
  yellow: { text: '#8C6807', bg: '#FCF3D9' },
  green: { text: '#2B7B53', bg: '#E8F5EE' },
  blue: { text: '#1C70AC', bg: '#E5F1FA' },
  purple: { text: '#8852B8', bg: '#F3ECF9' },
  pink: { text: '#BB367D', bg: '#FAEBF3' },
  red: { text: '#CA2C27', bg: '#FCE9E9' },
};

const colors = Object.entries(PALETTE)
  .map(([name, { text, bg }]) => `.ch-text-${name}{color:${text}}.ch-bg-${name}{background:${bg}}`)
  .join('');

export const EXPORT_STYLE = [
  ':root{color-scheme:light;print-color-adjust:exact;-webkit-print-color-adjust:exact}',
  'body{margin:0;background:#FFFFFF;color:#0A0A0A;font:1rem/1.5rem system-ui,-apple-system,"Segoe UI",sans-serif}',
  '.page{max-width:48rem;margin:0 auto;padding:3rem 1.5rem}',
  '.page-title{font-size:2.25rem;line-height:2.75rem;font-weight:700;margin:0 0 1.5rem}',
  'h2{font-size:1.875rem;line-height:1.3}h3{font-size:1.5rem;line-height:1.3}h4{font-size:1.25rem;line-height:1.3}',
  'h2,h3,h4{font-weight:600;margin:2rem 0 0.5rem}p{margin:0.25rem 0}',
  'a{color:inherit;text-decoration:underline;text-decoration-color:#A3A3A3}',
  '.properties{display:grid;gap:0.25rem;margin:0 0 1.5rem;color:#707070}',
  '.properties div{display:flex;gap:1rem}.properties dt{min-width:10rem}.properties dd{margin:0;color:#0A0A0A}',
  'blockquote{margin:0.5rem 0;padding-left:1rem;border-left:3px solid #0A0A0A}',
  '.callout{display:flex;gap:0.75rem;margin:0.5rem 0;padding:1rem;border-radius:8px;background:#FAFAFA;border:1px solid #E5E5E5}',
  'pre{margin:0.5rem 0;padding:1rem;border-radius:8px;background:#FAFAFA;overflow-x:auto;white-space:pre-wrap}',
  'code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:0.875rem}',
  ':not(pre)>code{padding:0.125rem 0.25rem;border-radius:4px;background:#F5F5F5}',
  'hr{border:0;border-top:1px solid #E5E5E5;margin:1rem 0}',
  'ul.tasks{list-style:none;padding-left:0}li.task{display:flex;gap:0.5rem}li.done>div{text-decoration:line-through;color:#707070}',
  'details{margin:0.25rem 0}summary{cursor:pointer}.toggle-body{padding-left:1.5rem}',
  '.columns{display:flex;gap:1.5rem}.column{flex:1;min-width:0}',
  'table{border-collapse:collapse;margin:0.5rem 0;width:100%}th,td{border:1px solid #E5E5E5;padding:0.5rem;text-align:left;vertical-align:top}',
  'thead{display:table-header-group}tr{break-inside:avoid}th{background:#FAFAFA;font-weight:600}',
  'figure{margin:1rem 0;break-inside:avoid}img{max-width:100%;height:auto}figcaption{color:#707070;font-size:0.875rem}',
  '.mention{font-weight:500}.missing{color:#707070;font-style:italic}',
  '@media (max-width:767px){.page{padding:1.5rem 1rem}.columns{display:block}}',
  colors,
].join('\n');
