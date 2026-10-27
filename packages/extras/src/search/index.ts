// @carehub/extras/search: shared names and pure logic (docs/extras/search.md).
export { fold, foldWithMap, titleKey, type FoldedText } from './fold';
export {
  parseQuery,
  wordsOf,
  SEARCH_TEXT_MAX,
  type MatchWord,
  type ParseOptions,
  type ParsedQuery,
  type SearchTerm,
} from './query';
export {
  highlightRanges,
  makeSnippet,
  rangeTexts,
  roughStem,
  SNIPPET_MAX_CHARS,
  type Snippet,
  type TextRange,
} from './snippet';
export { COMMON_WORDS, searchWords, SEARCH_WORDS_MAX } from './words';
export * from './schemas';
