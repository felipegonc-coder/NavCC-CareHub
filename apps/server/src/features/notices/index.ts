// What other features may use from notices (decision 0007, section 4.4). See README.md.
export type {
  NoticeActionButton,
  NoticeActionChoice,
  NoticeActionContext,
  NoticeActionHandler,
  NoticeActionResult,
  NoticeButton,
  NoticeCard,
  NoticeCreatedEvent,
  NoticeKind,
  NoticeLinkButton,
  SendNotice,
  SendNoticeInput,
  SendNoticeResult,
} from './types';
export { NOTICE_CREATED_EVENT, NOTICE_KINDS, NOTICES_CHANGED_EVENT } from './types';
export { NOTICE_LIMITS, NoticeInputError } from './domain/validate';
export { registerNoticeAction } from './domain/actions';
export { sendNotice } from './service';
