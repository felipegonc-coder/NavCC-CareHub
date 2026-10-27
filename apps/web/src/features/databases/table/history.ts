import { LIMITS, type Id } from '@carehub/databases';
import type { NewRow } from '../contract';

/** One value a change wrote, and the value it replaced. */
export interface ValueChange {
  rowId: Id;
  propertyId: Id;
  before: unknown;
  after: unknown;
}

/**
 * A row a change added ("+ New", or a paste past the last row). Undo moves it to Trash and redo
 * makes it again, so it's updated in place: `rowId` is the latest row made for it (null until the
 * first one is made), and `undone` says it should go to Trash as soon as it's made.
 */
export interface AddedRow {
  input: NewRow;
  /** The part of the table it was added to (it shows there until the answer has it). */
  sectionKey: string;
  rowId: Id | null;
  undone: boolean;
}

/** What one Ctrl+Z takes back: every value one edit, paste or "Set property" wrote. */
export interface Step {
  values: readonly ValueChange[];
  added: readonly AddedRow[];
}

/** The person's last changes in this table (LIMITS.undoSteps of them), to undo and redo. */
export class EditHistory {
  private past: Step[] = [];
  private future: Step[] = [];
  /** Rows made again by redo: old id → new id. */
  private renamed = new Map<Id, Id>();

  private readonly limit: number;

  constructor(limit: number = LIMITS.undoSteps) {
    this.limit = limit;
  }

  /** A new change: the oldest one goes past the limit, and there's nothing left to redo. */
  record(step: Step): void {
    if (step.values.length === 0 && step.added.length === 0) return;
    this.past.push(step);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }

  /** The step to take back, or undefined when there's none. */
  undo(): Step | undefined {
    const step = this.past.pop();
    if (step) this.future.push(step);
    return step;
  }

  /** The step to make again, or undefined when there's none. */
  redo(): Step | undefined {
    const step = this.future.pop();
    if (step) this.past.push(step);
    return step;
  }

  /** A row was made again: changes that name the old one now go to the new one. */
  rename(from: Id, to: Id): void {
    if (from !== to) this.renamed.set(from, to);
  }

  /** The row a change names now. */
  idOf(rowId: Id): Id {
    let id = rowId;
    // Each rename is followed at most once (so a loop can't run forever).
    for (let i = 0; i < this.renamed.size; i++) {
      const next = this.renamed.get(id);
      if (next === undefined) break;
      id = next;
    }
    return id;
  }

  /** Rows moved to Trash: their changes go, and steps left with nothing go too. */
  forget(rowIds: ReadonlySet<Id>): void {
    const keep = (step: Step): Step => ({
      values: step.values.filter((v) => !rowIds.has(this.idOf(v.rowId))),
      added: step.added.filter((a) => a.rowId === null || !rowIds.has(this.idOf(a.rowId))),
    });
    const left = (step: Step) => step.values.length > 0 || step.added.length > 0;
    this.past = this.past.map(keep).filter(left);
    this.future = this.future.map(keep).filter(left);
  }

  /** A property changed type or went: its values in the history can't be written back. */
  forgetProperty(propertyId: Id): void {
    for (const step of [...this.past, ...this.future]) {
      for (const row of step.added) {
        if (!row.input.values || !(propertyId in row.input.values)) continue;
        // Updated in place, as its id is (see AddedRow).
        const values = { ...row.input.values };
        delete values[propertyId];
        row.input = { ...row.input, values };
      }
    }
    const keep = (step: Step): Step => ({
      ...step,
      values: step.values.filter((v) => v.propertyId !== propertyId),
    });
    const left = (step: Step) => step.values.length > 0 || step.added.length > 0;
    this.past = this.past.map(keep).filter(left);
    this.future = this.future.map(keep).filter(left);
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.renamed.clear();
  }
}
