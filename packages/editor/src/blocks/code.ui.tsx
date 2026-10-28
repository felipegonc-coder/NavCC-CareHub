import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Decoration } from '@tiptap/pm/view';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import type { LanguageFn } from 'highlight.js';
import { Braces, Captions, Check, Copy, ListOrdered, WrapText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { NodeViews, SlashItem } from '../types';
import { codeHooks, refreshCodeColors } from './code';
import { blockItem } from './item.ui';
import './code.css';

/** A language in the code block menu, with the highlight.js grammar that colors it (if any). */
export interface CodeLanguage {
  /** What the block stores in `language`. */
  id: string;
  label: string;
  grammar?: string;
}

/** The languages in the menu after Plain text (spec 3.4: about 50, Mermaid included). */
export const CODE_LANGUAGES: readonly CodeLanguage[] = [
  { id: 'bash', label: 'Bash', grammar: 'bash' },
  { id: 'c', label: 'C', grammar: 'c' },
  { id: 'cpp', label: 'C++', grammar: 'cpp' },
  { id: 'csharp', label: 'C#', grammar: 'csharp' },
  { id: 'clojure', label: 'Clojure', grammar: 'clojure' },
  { id: 'css', label: 'CSS', grammar: 'css' },
  { id: 'dart', label: 'Dart', grammar: 'dart' },
  { id: 'diff', label: 'Diff', grammar: 'diff' },
  { id: 'dockerfile', label: 'Dockerfile', grammar: 'dockerfile' },
  { id: 'elixir', label: 'Elixir', grammar: 'elixir' },
  { id: 'erlang', label: 'Erlang', grammar: 'erlang' },
  { id: 'fsharp', label: 'F#', grammar: 'fsharp' },
  { id: 'go', label: 'Go', grammar: 'go' },
  { id: 'graphql', label: 'GraphQL', grammar: 'graphql' },
  { id: 'groovy', label: 'Groovy', grammar: 'groovy' },
  { id: 'haskell', label: 'Haskell', grammar: 'haskell' },
  { id: 'html', label: 'HTML', grammar: 'xml' },
  { id: 'http', label: 'HTTP', grammar: 'http' },
  { id: 'ini', label: 'INI', grammar: 'ini' },
  { id: 'java', label: 'Java', grammar: 'java' },
  { id: 'javascript', label: 'JavaScript', grammar: 'javascript' },
  { id: 'json', label: 'JSON', grammar: 'json' },
  { id: 'julia', label: 'Julia', grammar: 'julia' },
  { id: 'kotlin', label: 'Kotlin', grammar: 'kotlin' },
  { id: 'latex', label: 'LaTeX', grammar: 'latex' },
  { id: 'less', label: 'Less', grammar: 'less' },
  { id: 'lua', label: 'Lua', grammar: 'lua' },
  { id: 'makefile', label: 'Makefile', grammar: 'makefile' },
  { id: 'markdown', label: 'Markdown', grammar: 'markdown' },
  { id: 'matlab', label: 'MATLAB', grammar: 'matlab' },
  // Shown as code: diagrams aren't drawn (no preview).
  { id: 'mermaid', label: 'Mermaid' },
  { id: 'nginx', label: 'Nginx', grammar: 'nginx' },
  { id: 'objectivec', label: 'Objective-C', grammar: 'objectivec' },
  { id: 'ocaml', label: 'OCaml', grammar: 'ocaml' },
  { id: 'perl', label: 'Perl', grammar: 'perl' },
  { id: 'php', label: 'PHP', grammar: 'php' },
  { id: 'powershell', label: 'PowerShell', grammar: 'powershell' },
  { id: 'protobuf', label: 'Protocol Buffers', grammar: 'protobuf' },
  { id: 'python', label: 'Python', grammar: 'python' },
  { id: 'r', label: 'R', grammar: 'r' },
  { id: 'ruby', label: 'Ruby', grammar: 'ruby' },
  { id: 'rust', label: 'Rust', grammar: 'rust' },
  { id: 'scala', label: 'Scala', grammar: 'scala' },
  { id: 'scss', label: 'SCSS', grammar: 'scss' },
  { id: 'shell', label: 'Shell', grammar: 'bash' },
  { id: 'sql', label: 'SQL', grammar: 'sql' },
  { id: 'swift', label: 'Swift', grammar: 'swift' },
  { id: 'typescript', label: 'TypeScript', grammar: 'typescript' },
  { id: 'vbnet', label: 'Visual Basic', grammar: 'vbnet' },
  { id: 'xml', label: 'XML', grammar: 'xml' },
  { id: 'yaml', label: 'YAML', grammar: 'yaml' },
];

/** Other names for the languages, as pasted or imported code may have them. */
const ALIASES: Readonly<Record<string, string>> = {
  'c#': 'csharp',
  'c++': 'cpp',
  'f#': 'fsharp',
  'objective-c': 'objectivec',
  cc: 'cpp',
  cjs: 'javascript',
  clj: 'clojure',
  cs: 'csharp',
  docker: 'dockerfile',
  erl: 'erlang',
  ex: 'elixir',
  exs: 'elixir',
  gql: 'graphql',
  golang: 'go',
  gradle: 'groovy',
  hs: 'haskell',
  javascriptreact: 'javascript',
  jl: 'julia',
  js: 'javascript',
  json5: 'json',
  jsonc: 'json',
  jsx: 'javascript',
  kt: 'kotlin',
  make: 'makefile',
  md: 'markdown',
  mjs: 'javascript',
  ml: 'ocaml',
  objc: 'objectivec',
  patch: 'diff',
  pl: 'perl',
  proto: 'protobuf',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sass: 'scss',
  sh: 'bash',
  shellscript: 'bash',
  svg: 'xml',
  tex: 'latex',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  typescriptreact: 'typescript',
  vb: 'vbnet',
  yml: 'yaml',
  zsh: 'bash',
};

const byId = new Map(CODE_LANGUAGES.map((language) => [language.id, language]));

/** The menu language a stored `language` means (by id or other name), or null for plain text. */
export function codeLanguage(value: unknown): CodeLanguage | null {
  if (typeof value !== 'string' || !value) return null;
  const name = value.toLowerCase();
  return byId.get(name) ?? byId.get(ALIASES[name] ?? '') ?? null;
}

/** Remembers the language used last on this device, for the next code block (spec 3.4). */
export const LAST_LANGUAGE_KEY = 'carehub.editor.code-language';

function lastLanguage(): string | null {
  try {
    const stored = globalThis.localStorage?.getItem(LAST_LANGUAGE_KEY) ?? null;
    return stored && byId.has(stored) ? stored : null;
  } catch {
    // Storage can be off (private windows): new blocks start as Plain text.
    return null;
  }
}

function rememberLanguage(language: string | null) {
  try {
    if (language) globalThis.localStorage?.setItem(LAST_LANGUAGE_KEY, language);
    else globalThis.localStorage?.removeItem(LAST_LANGUAGE_KEY);
  } catch {
    // Storage can be off (private windows); the choice just isn't remembered.
  }
}

type Grammar = Promise<{ default: LanguageFn }>;

/** Each grammar loads on its own when a code block first needs it. */
const GRAMMARS: Readonly<Record<string, () => Grammar>> = {
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  clojure: () => import('highlight.js/lib/languages/clojure'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  dart: () => import('highlight.js/lib/languages/dart'),
  diff: () => import('highlight.js/lib/languages/diff'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  elixir: () => import('highlight.js/lib/languages/elixir'),
  erlang: () => import('highlight.js/lib/languages/erlang'),
  fsharp: () => import('highlight.js/lib/languages/fsharp'),
  go: () => import('highlight.js/lib/languages/go'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  groovy: () => import('highlight.js/lib/languages/groovy'),
  haskell: () => import('highlight.js/lib/languages/haskell'),
  http: () => import('highlight.js/lib/languages/http'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  julia: () => import('highlight.js/lib/languages/julia'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  latex: () => import('highlight.js/lib/languages/latex'),
  less: () => import('highlight.js/lib/languages/less'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  matlab: () => import('highlight.js/lib/languages/matlab'),
  nginx: () => import('highlight.js/lib/languages/nginx'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  ocaml: () => import('highlight.js/lib/languages/ocaml'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  powershell: () => import('highlight.js/lib/languages/powershell'),
  protobuf: () => import('highlight.js/lib/languages/protobuf'),
  python: () => import('highlight.js/lib/languages/python'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scala: () => import('highlight.js/lib/languages/scala'),
  scss: () => import('highlight.js/lib/languages/scss'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

type Lowlight = ReturnType<(typeof import('lowlight'))['createLowlight']>;

let lowlight: Lowlight | null = null;
let lowlightLoad: Promise<Lowlight> | null = null;
const grammarLoads = new Map<string, Promise<void>>();

function loadLowlight(): Promise<Lowlight> {
  lowlightLoad ??= import('lowlight').then(({ createLowlight }) => (lowlight = createLowlight()));
  return lowlightLoad;
}

/**
 * Loads the colors of a language (by id or other name). Resolves to true once they can be
 * drawn, or false for a language without colors (Plain text, Mermaid, unknown names).
 */
export function loadCodeLanguage(language: unknown): Promise<boolean> {
  const grammar = codeLanguage(language)?.grammar;
  const loadGrammar = grammar ? GRAMMARS[grammar] : undefined;
  if (!grammar || !loadGrammar) return Promise.resolve(false);
  let load = grammarLoads.get(grammar);
  if (!load) {
    load = Promise.all([loadLowlight(), loadGrammar()]).then(([instance, module]) => {
      if (!instance.registered(grammar)) instance.register(grammar, module.default);
    });
    // A failed download is tried again by the next block that needs it.
    load.catch(() => grammarLoads.delete(grammar));
    grammarLoads.set(grammar, load);
  }
  return load.then(() => true);
}

/** A run of code text with the highlight.js classes around it. */
interface Token {
  from: number;
  to: number;
  className: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function classesOf(properties: unknown): string {
  if (!isRecord(properties) || !Array.isArray(properties.className)) return '';
  return properties.className.filter((name) => typeof name === 'string').join(' ');
}

/** Flattens lowlight's tree into runs of text with all the classes around them. */
function collectTokens(node: unknown, offset: number, classes: string, tokens: Token[]): number {
  if (!isRecord(node)) return offset;
  if (node.type === 'text' && typeof node.value === 'string') {
    const end = offset + node.value.length;
    if (classes && end > offset) tokens.push({ from: offset, to: end, className: classes });
    return end;
  }
  const own = node.type === 'element' ? classesOf(node.properties) : '';
  const inner = own && classes ? `${classes} ${own}` : own || classes;
  let at = offset;
  if (Array.isArray(node.children)) {
    for (const child of node.children) at = collectTokens(child, at, inner, tokens);
  }
  return at;
}

/** Highlighting is worked out again only for code blocks that changed. */
const tokenCache = new WeakMap<ProseMirrorNode, Token[]>();

function tokensOf(node: ProseMirrorNode, grammar: string, instance: Lowlight): Token[] {
  const cached = tokenCache.get(node);
  if (cached) return cached;
  const tokens: Token[] = [];
  try {
    collectTokens(instance.highlight(grammar, node.textContent), 0, '', tokens);
  } catch {
    // A grammar that fails on some text leaves that block uncolored.
  }
  tokenCache.set(node, tokens);
  return tokens;
}

/** Where each line of `text` starts, the empty last line after a final line break too. */
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', end + 1)) {
    starts.push(end + 1);
  }
  return starts;
}

function lineNumber(line: number): HTMLElement {
  const element = document.createElement('span');
  element.className = 'ch-code-line-number';
  element.setAttribute('aria-hidden', 'true');
  element.textContent = String(line);
  return element;
}

/** The syntax colors (once the language has loaded) and line numbers of one code block. */
function decorateCode(node: ProseMirrorNode, pos: number): Decoration[] {
  const found: Decoration[] = [];
  const start = pos + 1;
  const grammar = codeLanguage(node.attrs.language)?.grammar;
  if (grammar && lowlight?.registered(grammar)) {
    for (const token of tokensOf(node, grammar, lowlight)) {
      found.push(
        Decoration.inline(start + token.from, start + token.to, { class: token.className }),
      );
    }
  }
  if (node.attrs.lineNumbers === true) {
    lineStarts(node.textContent).forEach((offset, index) => {
      const line = index + 1;
      found.push(
        Decoration.widget(start + offset, () => lineNumber(line), {
          side: -1,
          key: `line-${line}`,
          ignoreSelection: true,
        }),
      );
    });
  }
  return found;
}

Object.assign(codeHooks, { language: lastLanguage, decorate: decorateCode });

const refreshing = new WeakSet<Editor>();

/** Draws the colors again once, however many blocks of a language were waiting for it. */
function refreshSoon(editor: Editor) {
  if (refreshing.has(editor)) return;
  refreshing.add(editor);
  queueMicrotask(() => {
    refreshing.delete(editor);
    if (!editor.isDestroyed) refreshCodeColors(editor.view);
  });
}

/** How long "Copied" shows after Copy. */
const COPIED_MS = 2000;

/**
 * A code block: the language menu, Wrap lines, Line numbers, Caption and Copy above the code,
 * and the caption under it. In a read-only page only the language name, Copy and the caption
 * show.
 */
function CodeBlockView({ node, editor, updateAttributes }: ReactNodeViewProps) {
  const stored: unknown = node.attrs.language;
  const language = typeof stored === 'string' && stored ? stored : null;
  const known = codeLanguage(language);
  const wrap = node.attrs.wrap === true;
  const lineNumbers = node.attrs.lineNumbers === true;
  const caption = typeof node.attrs.caption === 'string' ? node.attrs.caption : '';
  const editable = editor.isEditable;
  const [captionOpen, setCaptionOpen] = useState(false);
  const [draft, setDraft] = useState(caption);
  const [copied, setCopied] = useState(false);
  const captionRef = useRef<HTMLInputElement>(null);
  const editingCaption = useRef(false);

  useEffect(() => {
    let live = true;
    loadCodeLanguage(language).then(
      (loaded) => {
        if (loaded && live) refreshSoon(editor);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [editor, language]);

  // Someone else's caption edit shows unless you're typing in it.
  useEffect(() => {
    if (!editingCaption.current) setDraft(caption);
  }, [caption]);

  useEffect(() => {
    if (captionOpen) captionRef.current?.focus();
  }, [captionOpen]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const chooseLanguage = (value: string) => {
    const next = value || null;
    updateAttributes({ language: next });
    rememberLanguage(next);
  };

  const copy = () => {
    navigator.clipboard?.writeText(node.textContent).then(
      () => setCopied(true),
      () => undefined,
    );
  };

  const label = known?.label ?? language ?? 'Plain text';
  const showCaption = captionOpen || caption !== '';

  return (
    <NodeViewWrapper
      className="ch-code"
      data-wrap={wrap ? '' : undefined}
      data-line-numbers={lineNumbers ? '' : undefined}
    >
      <div className="ch-code-box">
        <div className="ch-code-bar" contentEditable={false}>
          {editable ? (
            <select
              className="ch-code-language"
              aria-label="Language"
              value={known?.id ?? language ?? ''}
              onChange={(event) => chooseLanguage(event.target.value)}
            >
              <option value="">Plain text</option>
              {language && !known ? <option value={language}>{label}</option> : null}
              {CODE_LANGUAGES.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="ch-code-language">{label}</span>
          )}
          <span className="ch-code-actions">
            {editable ? (
              <>
                <button
                  type="button"
                  className="ch-code-button"
                  aria-label="Wrap lines"
                  title="Wrap lines"
                  aria-pressed={wrap}
                  onClick={() => updateAttributes({ wrap: !wrap })}
                >
                  <WrapText size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ch-code-button"
                  aria-label="Line numbers"
                  title="Line numbers"
                  aria-pressed={lineNumbers}
                  onClick={() => updateAttributes({ lineNumbers: !lineNumbers })}
                >
                  <ListOrdered size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="ch-code-button"
                  aria-label="Caption"
                  title="Caption"
                  aria-pressed={showCaption}
                  onClick={() => {
                    if (showCaption) captionRef.current?.focus();
                    else setCaptionOpen(true);
                  }}
                >
                  <Captions size={16} aria-hidden="true" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="ch-code-button"
              aria-label={copied ? 'Copied' : 'Copy code'}
              title={copied ? 'Copied' : 'Copy code'}
              onClick={copy}
            >
              {copied ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                <Copy size={16} aria-hidden="true" />
              )}
            </button>
          </span>
        </div>
        <pre spellCheck={false}>
          <NodeViewContent<'code'>
            as="code"
            className={known?.grammar ? `language-${known.grammar}` : undefined}
            style={{ whiteSpace: wrap ? 'pre-wrap' : 'pre' }}
          />
        </pre>
      </div>
      {showCaption && editable ? (
        <input
          ref={captionRef}
          className="ch-code-caption"
          aria-label="Caption"
          placeholder="Write a caption"
          value={draft}
          onFocus={() => (editingCaption.current = true)}
          onChange={(event) => {
            setDraft(event.target.value);
            updateAttributes({ caption: event.target.value });
          }}
          onBlur={() => {
            editingCaption.current = false;
            setCaptionOpen(false);
          }}
        />
      ) : null}
      {showCaption && !editable ? <p className="ch-code-caption">{caption}</p> : null}
    </NodeViewWrapper>
  );
}

export const slashItems: SlashItem[] = [
  blockItem({
    id: 'codeBlock',
    title: 'Code',
    description: 'A block of code',
    // The spec lists Code with the media blocks.
    group: 'Media',
    keywords: ['code', 'snippet', 'pre'],
    hint: '```',
    icon: Braces,
    unless: 'codeBlock',
    apply: (chain) => {
      const language = lastLanguage();
      return language ? chain.setCodeBlock({ language }) : chain.setCodeBlock();
    },
  }),
];

export const nodeViews: NodeViews = { codeBlock: CodeBlockView };
