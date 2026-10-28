// What other features may use from the page model (decision 0007, sections 3.3 and 4.1).
export {
  getAccessForPages,
  getGrantLevel,
  getPageAccess,
  grantAccess,
  pageAccessOf,
  registerAccessResolver,
  revokeAccess,
} from './access';
export type { GrantAccessInput, PageAnswer, Principal, RowAccessContext } from './access';
export {
  GENERAL_SPACE,
  getPrivateSpaceId,
  joinDefaultSpaces,
  setUpWorkspaceSpaces,
} from './spaces';
export { getPageCards } from './cards';
export { createPage, setPageTitle } from './pages';
export type { NewPage, PageRow } from './pages';
