/**
 * The formula engine: parse, check and run formulas; convert between stored (ids) and shown
 * (names) forms; list what formulas read; and find loops. Importing this loads every function.
 */
import './functions/core';
import './functions/text';
import './functions/lists';
import './functions/dates';

export {
  BOOLEAN,
  DATE,
  EMPTY,
  EMPTY_TYPE,
  FUNCTION_KINDS,
  FUNCTION_KIND_LABELS,
  FormulaFailure,
  MAX_TEXT_LENGTH,
  NUMBER,
  PERSON,
  REQUEST_FORMULA_MS,
  ROW_TEXT_LIMIT,
  TEXT,
  TOO_COMPLEX,
  TOO_MUCH_TEXT,
  TOO_SLOW,
  defineFunction,
  fail,
  formatText,
  formulaBudget,
  getFunction,
  isEmpty,
  joinParts,
  listFunctions,
  listType,
  spendText,
  textLeft,
  typeName,
  unify,
} from './registry';
export type {
  Call,
  FormulaBudget,
  FormulaContext,
  FormulaError,
  FormulaSchema,
  FormulaType,
  FunctionDef,
  FunctionInfo,
  FunctionKind,
  PatternEngine,
  PatternLimits,
  PatternResult,
  Signature,
  TypePattern,
} from './registry';
export {
  MAX_PATTERN_COPIES,
  MAX_PATTERN_LENGTH,
  MAX_PATTERN_PROGRAM,
  PATTERNS,
  PATTERN_CACHE_SIZE,
  PATTERN_MESSAGES,
  PATTERN_TEXT_LENGTH,
  createPatternEngine,
} from './patterns';
export type { CachedPatternEngine } from './patterns';
export { parseFormula } from './parser';
export type { Node, ParseResult } from './parser';
export { LENGTH_MESSAGE, RELATION_DEPTH, TEXT_AND_NUMBER, checkFormula } from './check';
export { basicSchema, defaultKindOf, fromComputedKind, propertyType, resultKindOf } from './kinds';
export type { CheckMode, CheckResult } from './check';
export { FORMULA_BROKE, compileFormula, readProperty } from './evaluate';
export type { CompileResult, CompiledFormula } from './evaluate';
export {
  CHAIN_MESSAGE,
  LOOP_MESSAGE,
  computedChainError,
  cycleMessage,
  findComputedCycle,
  formulaDependencies,
  quoteText,
  toDisplayFormula,
  toStoredFormula,
} from './names';
export type { ComputedNode, FormulaDependencies, StoredFormula } from './names';
