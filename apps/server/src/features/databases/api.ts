// Server functions for other lanes (decision 0200). Each checks the person's access first and
// refuses (403) before any change. The row functions (listDatedRows, listDateSources, setRowDate,
// listViewRows, createRow, createRows, updateRows, readRow, readRowText, exportViewCsv) join from
// the row server; making and copying databases is in create.ts.
export { createDatabase, duplicateDatabase } from './create';
export type { CreatedDatabase, DatabaseCopy } from './create';
export { THIS_DATABASE } from './define';
export type {
  DatabaseDefinition,
  DefinitionRow,
  DefinitionTemplate,
  DefinitionView,
  DuplicateInput,
} from './define';
