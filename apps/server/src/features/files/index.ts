// What other features use from Files (decision 0007, section 4.3).
export {
  registerFileScope,
  type AnonymousFileScopeContext,
  type FileScope,
  type FileScopeContext,
} from './scopes';
export {
  claimFiles,
  deleteFiles,
  getFile,
  getFiles,
  removeDeletedFiles,
  type FileInfo,
  type StoredFile,
} from './service';
