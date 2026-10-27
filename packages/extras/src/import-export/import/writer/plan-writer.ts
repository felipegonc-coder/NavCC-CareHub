// What the Evernote, Confluence, Trello and Asana importers share while they write a plan: unique
// keys, fields cut to their limits (each cut listed as a problem), the problem list kept to what
// a plan can hold, and the plan's text counted as it grows, so a file that would make more than an
// import's text stops at once, before it's all in memory (docs/extras/import-export.md#safety).
import { clip, IMPORT_LIMITS, ImportFileError, type ImportPlan, type ImportProblem } from '../plan';

export const TOO_MUCH_TEXT = 'imports can have up to 10 MB of text';
/** The longest file, what and why a plan's problem can have (planUploadSchema's limits). */
const PROBLEM_CHARS = { file: 1_000, what: 200, why: 1_000 };

export class PlanWriter {
  readonly plan: ImportPlan = { pages: [], databases: [], files: [], problems: [] };
  #chars = 0;
  #unlisted = 0;
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

  /** `value` cut to `max` characters; a cut is listed as a problem about `item`. */
  cut(value: string, max: number, item: string): string {
    const kept = clip(value, max);
    if (kept.length < value.length) {
      const why = `Only the first ${max.toLocaleString('en-US')} characters were kept.`;
      this.problem(item, 'Cut short', why);
    }
    return kept;
  }

  /** `value` cut to `max` characters, as `cut` does, and counted. */
  text(value: string, max: number, item: string): string {
    const kept = this.cut(value, max, item);
    this.spend(kept.length);
    return kept;
  }

  /** The `file` of a problem about `item` of the file (a card, a note), or the whole file. */
  where(item: string | null): string {
    return item === null ? this.file : `${this.file}: ${item}`;
  }

  /** Lists what happened to `item` (or the whole file, for null) and why. */
  problem(item: string | null, what: string, why: string): void {
    this.add([{ file: this.where(item), what, why }]);
  }

  /**
   * Lists problems another reader found. The list keeps 999 and the last line counts the rest
   * (see done), since a plan can list 1,000.
   */
  add(problems: readonly ImportProblem[]): void {
    for (const { file, what, why } of problems) {
      if (this.plan.problems.length >= IMPORT_LIMITS.problems - 1) {
        this.#unlisted += 1;
        continue;
      }
      this.plan.problems.push({
        file: clip(file, PROBLEM_CHARS.file),
        what: clip(what, PROBLEM_CHARS.what),
        why: clip(why, PROBLEM_CHARS.why),
      });
    }
  }

  /** The plan, with a last problem line for the problems the list had no room for. */
  done(): ImportPlan {
    if (this.#unlisted > 0) {
      const count = this.#unlisted.toLocaleString('en-US');
      const why = `${count} more ${this.#unlisted === 1 ? 'problem' : 'problems'} like the ones above.`;
      this.plan.problems.push({ file: this.file, what: 'Not listed', why });
      this.#unlisted = 0;
    }
    return this.plan;
  }
}

/** The start of `text` on one line, to name an item in a problem. */
export function shortName(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 60 ? `${clip(line, 57)}...` : line;
}
