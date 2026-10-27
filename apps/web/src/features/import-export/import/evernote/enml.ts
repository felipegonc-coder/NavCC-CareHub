// A note's ENML (Evernote's XHTML) as HTML for the Import screen's HTML reader, with the browser's
// DOMParser: <en-media> becomes the note's picture or a link to its file, Evernote's to-dos (both
// <en-todo> and the newer checklists) become to-do lists, its code blocks become code, and
// encrypted text a line saying it wasn't brought in. Attachments the note doesn't place go at its
// end, as Evernote lists them.

/** An attachment the note can show: its address in the plan, its name, and if it's a picture. */
export interface EnmlAttachment {
  href: string;
  name: string;
  image: boolean;
}

export interface EnmlHtml {
  html: string;
  /** `<en-media>` whose attachment isn't in the export. */
  missing: number;
  /** `<en-crypt>` sections, which only Evernote can open. */
  encrypted: number;
}

export const ENCRYPTED_LINE = "Encrypted text isn't brought in.";

/**
 * `<en-media/>` and `<en-todo/>` with an end tag: the HTML parser ignores "/>" on elements it
 * doesn't know, which would put everything after them inside them.
 */
const closeEmptyTags = (enml: string) =>
  enml.replace(/<(en-media|en-todo)\b([^<>]*?)\s*\/>/gi, '<$1$2></$1>');

/** Evernote's style switches, such as `--en-codeblock:true` (older notes have one dash). */
const styleHas = (element: Element, setting: string) =>
  new RegExp(`(?:^|[;\\s])--?en-${setting}\\s*:\\s*true`).test(element.getAttribute('style') ?? '');

const isBlank = (node: Node | null) =>
  node !== null && node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '';

/** The element's first child that isn't white space. */
function firstChild(element: Element): Node | null {
  let node = element.firstChild;
  while (isBlank(node)) node = node?.nextSibling ?? null;
  return node;
}

/** The sibling before `node` that isn't white space. */
function previous(node: Node): Node | null {
  let before = node.previousSibling;
  while (isBlank(before)) before = before?.previousSibling ?? null;
  return before;
}

function attachmentElement(doc: Document, attachment: EnmlAttachment): HTMLElement {
  if (attachment.image) {
    const image = doc.createElement('img');
    image.setAttribute('src', attachment.href);
    image.setAttribute('alt', attachment.name);
    return image;
  }
  const link = doc.createElement('a');
  link.setAttribute('href', attachment.href);
  link.textContent = attachment.name;
  return link;
}

function taskList(doc: Document): HTMLUListElement {
  const list = doc.createElement('ul');
  list.setAttribute('data-type', 'taskList');
  return list;
}

function markTaskItem(item: Element, checked: boolean): void {
  item.setAttribute('data-type', 'taskItem');
  item.setAttribute('data-checked', String(checked));
}

/** HTML for one note's ENML, with `attachments` by the MD5 hash `<en-media>` names them by. */
export function enmlToHtml(
  enml: string,
  attachments: ReadonlyMap<string, EnmlAttachment>,
): EnmlHtml {
  const doc = new DOMParser().parseFromString(closeEmptyTags(enml), 'text/html');
  const root = doc.querySelector('en-note') ?? doc.body;
  const placed = new Set<string>();
  let missing = 0;
  let encrypted = 0;

  for (const media of Array.from(root.querySelectorAll('en-media'))) {
    const hash = (media.getAttribute('hash') ?? '').trim().toLowerCase();
    const attachment = attachments.get(hash);
    if (attachment) {
      placed.add(hash);
      media.replaceWith(attachmentElement(doc, attachment));
    } else {
      missing += 1;
      media.remove();
    }
  }

  for (const crypt of Array.from(root.querySelectorAll('en-crypt'))) {
    encrypted += 1;
    const line = doc.createElement('p');
    line.textContent = ENCRYPTED_LINE;
    crypt.replaceWith(line);
  }

  // Older notes: a line (a div or p) that starts with <en-todo checked="true"/>. Lines in a row
  // make one to-do list; a to-do anywhere else becomes a box character.
  for (const todo of Array.from(root.querySelectorAll('en-todo'))) {
    const checked = todo.getAttribute('checked') === 'true';
    const line = todo.parentElement;
    if (!line || !['DIV', 'P'].includes(line.tagName) || firstChild(line) !== todo) {
      todo.replaceWith(doc.createTextNode(checked ? '☑ ' : '☐ '));
      continue;
    }
    todo.remove();
    const item = doc.createElement('li');
    markTaskItem(item, checked);
    const text = doc.createElement('p');
    text.append(...Array.from(line.childNodes));
    item.append(text);
    const before = previous(line);
    if (before instanceof Element && before.getAttribute('data-type') === 'taskList') {
      before.append(item);
      line.remove();
    } else {
      const list = taskList(doc);
      list.append(item);
      line.replaceWith(list);
    }
  }

  // Newer notes: <ul style="--en-todo:true;"> with <li style="--en-checked:true;">.
  for (const list of Array.from(root.querySelectorAll('ul'))) {
    if (!styleHas(list, 'todo')) continue;
    list.setAttribute('data-type', 'taskList');
    for (const item of Array.from(list.children)) {
      if (item.tagName === 'LI') markTaskItem(item, styleHas(item, 'checked'));
    }
  }

  // Code blocks: <div style="--en-codeblock:true;"> with a div per line.
  for (const block of Array.from(root.querySelectorAll('div'))) {
    if (!block.isConnected || !styleHas(block, 'codeblock')) continue;
    const pre = doc.createElement('pre');
    const code = doc.createElement('code');
    code.textContent = Array.from(block.childNodes, (node) => node.textContent ?? '').join('\n');
    pre.append(code);
    block.replaceWith(pre);
  }

  for (const [hash, attachment] of attachments) {
    if (placed.has(hash)) continue;
    const line = doc.createElement('p');
    line.append(attachmentElement(doc, attachment));
    root.append(line);
  }

  return { html: root.innerHTML, missing, encrypted };
}
