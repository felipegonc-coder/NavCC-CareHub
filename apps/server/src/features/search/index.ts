// What other features may use from search (docs/extras/search.md).
export { indexPages as reindexForSearch, registerSearchText } from './indexer';
export type { SearchTextSource } from './indexer';
export { registerSearchBoost, runSearch } from './search';
export type { SearchBoost, Searcher } from './search';
