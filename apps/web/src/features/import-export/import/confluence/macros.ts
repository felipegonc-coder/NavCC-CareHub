// A Confluence page's content made ready for the Import screen's HTML reader (Import and export
// spec, section 3.2; IE-06), rewritten in place with the browser's DOM. Info, note, warning and tip
// panels (and plain panels) become callouts, written as Care Hub's HTML export writes them. Code
// macros become code blocks, task lists to-dos, and emoticons emoji. Other macros keep their text
// and are counted by name, so the summary lists each kind once.

/** Each panel's callout icon, by the kind Confluence gives it. */
const PANEL_ICONS: Partial<Record<string, string>> = {
  information: 'ℹ️',
  info: 'ℹ️',
  note: '📝',
  warning: '⚠️',
  tip: '💡',
  panel: '📌',
};

/** Confluence's emoticons, by name, as emoji. */
const EMOTICONS: Partial<Record<string, string>> = {
  smile: '🙂',
  sad: '🙁',
  cheeky: '😛',
  laugh: '😀',
  wink: '😉',
  'thumbs-up': '👍',
  'thumbs-down': '👎',
  information: 'ℹ️',
  tick: '✅',
  cross: '❌',
  warning: '⚠️',
  plus: '➕',
  minus: '➖',
  question: '❓',
  'light-on': '💡',
  'light-off': '💡',
  'yellow-star': '⭐',
  'red-star': '⭐',
  'green-star': '⭐',
  'blue-star': '⭐',
  heart: '❤️',
  'broken-heart': '💔',
};

/** A code macro's language ("brush: js") as code blocks name it. */
const BRUSHES: Partial<Record<string, string>> = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  py: 'python',
  python: 'python',
  bash: 'bash',
  shell: 'bash',
  sh: 'bash',
  sql: 'sql',
  xml: 'xml',
  html: 'html',
  css: 'css',
  json: 'json',
  yaml: 'yaml',
  java: 'java',
  csharp: 'csharp',
  cpp: 'cpp',
  ruby: 'ruby',
  php: 'php',
  go: 'go',
  powershell: 'powershell',
};

/** Macros that older exports mark with a class, not `data-macro-name`. */
const MACRO_CLASSES: readonly (readonly [string, string])[] = [
  ['expand-container', 'expand'],
  ['toc-macro', 'toc'],
  ['status-macro', 'status'],
  ['jira-issue', 'jira'],
  ['recently-updated', 'recently-updated'],
  ['plugin_pagetree', 'pagetree'],
];

const ICON_PICTURE = /(?:^|\/)images\/icons\//;

function macroName(element: Element): string | null {
  const name = element.getAttribute('data-macro-name')?.trim().toLowerCase();
  if (name) return name.slice(0, 50);
  return MACRO_CLASSES.find(([name]) => element.classList.contains(name))?.[1] ?? null;
}

/** The kind of an info, note, warning or tip panel, from its class or its macro name. */
function panelKind(element: Element): string | null {
  if (element.classList.contains('confluence-information-macro')) {
    for (const kind of ['information', 'note', 'warning', 'tip']) {
      if (element.classList.contains(`confluence-information-macro-${kind}`)) return kind;
    }
    return 'information';
  }
  const name = macroName(element);
  if (name === 'info' || name === 'note' || name === 'warning' || name === 'tip') return name;
  const code = element.classList.contains('code') || element.classList.contains('preformatted');
  return name === 'panel' || (element.classList.contains('panel') && !code) ? 'panel' : null;
}

function isCode(element: Element): boolean {
  const name = macroName(element);
  if (name === 'code' || name === 'noformat') return true;
  const panel = element.classList.contains('panel');
  return (
    panel && (element.classList.contains('code') || element.classList.contains('preformatted'))
  );
}

function titleParagraph(doc: Document, title: string): HTMLParagraphElement {
  const paragraph = doc.createElement('p');
  const strong = doc.createElement('strong');
  strong.textContent = title;
  paragraph.append(strong);
  return paragraph;
}

/** A panel as a callout: its title in bold, then its body. */
function callout(doc: Document, panel: Element, kind: string): HTMLElement {
  const info = kind !== 'panel';
  const title = panel.querySelector(info ? '.title' : '.panelHeader')?.textContent?.trim() ?? '';
  const body = panel.querySelector(info ? '.confluence-information-macro-body' : '.panelContent');
  const aside = doc.createElement('aside');
  aside.className = 'callout';
  const icon = doc.createElement('span');
  icon.className = 'callout-icon';
  icon.textContent = PANEL_ICONS[kind] ?? '💡';
  const content = doc.createElement('div');
  content.className = 'callout-body';
  if (title) content.append(titleParagraph(doc, title));
  content.append(...Array.from((body ?? panel).childNodes));
  aside.append(icon, content);
  return aside;
}

/** A code macro as a code block, with its title in bold before it. */
function codeBlock(doc: Document, macro: Element): Node[] {
  const pre = macro.querySelector('pre');
  const params = pre?.getAttribute('data-syntaxhighlighter-params') ?? '';
  const brush = /(?:^|;)\s*brush:\s*([\w#+-]+)/i.exec(params)?.[1]?.toLowerCase();
  const language = brush ? BRUSHES[brush] : undefined;
  const block = doc.createElement('pre');
  const code = doc.createElement('code');
  if (language) code.className = `language-${language}`;
  code.textContent = (pre ?? macro).textContent?.replace(/\n$/, '') ?? '';
  block.append(code);
  const title = macro.querySelector('.codeHeader')?.textContent?.trim();
  return title ? [titleParagraph(doc, title), block] : [block];
}

function emoji(image: Element): string {
  const named =
    image.getAttribute('data-emoticon-name') ??
    Array.from(image.classList)
      .find((name) => name.startsWith('emoticon-'))
      ?.slice('emoticon-'.length);
  return (
    (named ? EMOTICONS[named] : undefined) ??
    image.getAttribute('data-emoji-fallback') ??
    image.getAttribute('alt') ??
    ''
  );
}

/**
 * Rewrites the page's content `body` in place, and gives the macros that kept only their text,
 * counted by name.
 */
export function rewriteMacros(body: Element): Map<string, number> {
  const doc = body.ownerDocument;
  const kept = new Map<string, number>();
  for (const element of Array.from(body.querySelectorAll('*'))) {
    if (!body.contains(element)) continue;
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'noscript') {
      element.remove();
    } else if (tag === 'img' && element.classList.contains('emoticon')) {
      element.replaceWith(doc.createTextNode(emoji(element)));
    } else if (tag === 'img' && ICON_PICTURE.test(element.getAttribute('src') ?? '')) {
      element.remove();
    } else if (isCode(element)) {
      element.replaceWith(...codeBlock(doc, element));
    } else if (panelKind(element)) {
      element.replaceWith(callout(doc, element, panelKind(element) ?? 'panel'));
    } else if (tag === 'ul' && element.classList.contains('inline-task-list')) {
      element.setAttribute('data-type', 'taskList');
      for (const item of Array.from(element.children)) {
        item.setAttribute('data-type', 'taskItem');
        item.setAttribute('data-checked', String(item.classList.contains('checked')));
      }
    } else {
      const name = macroName(element);
      if (name === null) continue;
      kept.set(name, (kept.get(name) ?? 0) + 1);
      element.replaceWith(...Array.from(element.childNodes));
    }
  }
  return kept;
}
