// What the Evernote, Confluence, Trello and Asana importers share while they write a plan: unique
// keys, fields cut to their limits (each cut listed as a problem), and the plan's text counted as
// it grows, so a file that would make more than an import's text stops at once, before it's all
// in memory (docs/extras/import-export.md#safety, output caps).
import { clip, IMPORT_LIMITS, ImportFileError, type ImportPlan } from '../plan';

export const TOO_MUCH_TEXT = 'imports can have up to 10 MB of text';

export class PlanWriter {
  readonly plan: ImportPlan = { pages: [], databases: [], files: [], problems: [] };
  #chars = 0;
  readonly #keys = new Map<string, number>();

  /** `file`: the name of the file being read, for its problems. */
  constructor(readonly file: string) {}

  /** A new key, such as `card-12`. `kind` is letters only, so keys stay unique and plain. */
  key(kind: string): string {
    const n = (this.#keys.get(kind) ?? 0) + 1;
    this.#keys.set(kind, n);
    return `${kind}-${n}`;
  }

  /** Counts `chars` more characters of the plan; throws once it's past the import's limit. */
  spend(chars: number): void {
    this.#chars += chars;
    if (this.#chars > IMPORT_LIMITS.textChars) throw new ImportFileError(TOO_MUCH_TEXT);
  }

  /** `value` cut to `max` characters; a cut is listed as a problem about `what`. */
  cut(value: string, max: number, what: string): string {
    const kept = clip(value, max);
    if (kept.length < value.length) {
      this.problem(what, `It was cut to ${max.toLocaleString('en-US')} characters.`);
    }
    return kept;
  }

  /** `value` cut to `max` characters, as `cut` does, and counted. */
  text(value: string, max: number, what: string): string {
    const kept = this.cut(value, max, what);
    this.spend(kept.length);
    return kept;
  }

  problem(what: string, why: string): void {
    this.plan.problems.push({ file: this.file, what, why });
  }
}

/** The start of `text` on one line, to name an item in a problem. */
export function shortName(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${clip(line, 57)}...` : line;
}
