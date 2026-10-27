// What other features use from Files (decision 0007, section 4.3).
export { registerFileScope, type FileScope, type FileScopeContext } from './scopes';
export {
  deleteFiles,
  getFile,
  getFiles,
  removeDeletedFiles,
  saveFile,
  type FileInfo,
  type StoredFile,
} from './service';
