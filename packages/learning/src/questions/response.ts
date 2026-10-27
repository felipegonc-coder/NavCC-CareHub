import type { Question, QuestionResponse } from '../format/index';

type QuestionType = Question['type'];

type MemberFor<R, T> = R extends { type: infer K }
  ? [Extract<T, K>] extends [never]
    ? never
    : R
  : never;

/** The `QuestionResponse` shape that answers a question of type `T`. */
export type ResponseFor<T extends QuestionType> = MemberFor<QuestionResponse, T>;

/**
 * Type guard: true when `r` is a response to a question of `q`'s type (exactly the same `type`, so
 * a drag-matching response never answers a matching question) with a well-formed payload. Anything
 * else, including `undefined`, counts as unanswered when scoring.
 */
export function isResponseFor<Q extends Question>(q: Q, r: unknown): r is ResponseFor<Q['type']> {
  const type: QuestionType = q.type;
  return isRecord(r) && r['type'] === type && hasPayload(type, r);
}

function hasPayload(type: QuestionType, r: Record<string, unknown>): boolean {
  switch (type) {
    case 'single_choice':
      return typeof r['optionId'] === 'string';
    case 'multiple_choice':
      return isStringArray(r['optionIds']);
    case 'true_false':
      return typeof r['value'] === 'boolean';
    case 'matching':
    case 'drag_matching':
      return isStringRecord(r['matches']);
    case 'fill_blank':
      return isStringRecord(r['blanks']);
    case 'ordering':
      return isStringArray(r['order']);
    case 'hotspot':
      return isHotspotPick(r['pick']);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStringRecord(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string');
}

function isHotspotPick(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'spot') return typeof value['spotId'] === 'string';
  return value['kind'] === 'point' && isFiniteNumber(value['x']) && isFiniteNumber(value['y']);
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
