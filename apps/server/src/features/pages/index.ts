// What other features may use from the page model (decision 0007, sections 3.3 and 4.1).
export {
  getAccessForPages,
  getPageAccess,
  grantAccess,
  pageAccessOf,
  registerAccessResolver,
  revokeAccess,
} from './access';
export type { GrantAccessInput, PageAnswer, Principal, RowAccessContext } from './access';
