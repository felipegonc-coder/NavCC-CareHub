import { COPY } from './constants';
import { systemLineText } from './system-lines';
import type { SystemEvent } from './system-lines';
import { collapseWhitespace, isBlankText, truncateText } from './text';
import { messagePlainText } from './tokens';
import type { AttachmentKind, NameOf } from './types';

/** Chat list previews are cut to this many characters (the list also cuts them to one line). */
export const PREVIEW_MAX_LENGTH = 100;

export interface PreviewAttachment {
  kind: AttachmentKind;
  name: string;
}

/** The parts of a message, notice or system line that its preview needs. */
export type PreviewSource =
  | {
      kind: 'message';
      text: string;
      deleted: boolean;
      mentionedUserIds: readonly string[];
      attachments?: readonly PreviewAttachment[];
      pageCount?: number;
    }
  | { kind: 'notice'; title: string; text?: string | null }
  | { kind: 'system'; event: SystemEvent };

const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

/** "Picture", "Schedule.pdf", "3 pictures", "2 files", "3 pictures and 1 file". */
export function attachmentSummary(attachments: readonly PreviewAttachment[]): string {
  const [only] = attachments;
  if (attachments.length === 1 && only) return only.kind === 'picture' ? 'Picture' : only.name;
  const pictures = attachments.filter((file) => file.kind === 'picture').length;
  const files = attachments.length - pictures;
  const parts: string[] = [];
  if (pictures > 0) parts.push(counted(pictures, 'picture', 'pictures'));
  if (files > 0) parts.push(counted(files, 'file', 'files'));
  return parts.join(' and ');
}

function previewText(source: PreviewSource, nameOf: NameOf): string {
  switch (source.kind) {
    case 'system':
      return systemLineText(source.event, nameOf);
    case 'notice': {
      const text = source.text ?? '';
      return isBlankText(text) ? source.title : `${source.title} – ${text}`;
    }
    case 'message': {
      if (source.deleted) return COPY.deletedMessage;
      const text = messagePlainText(source.text, nameOf, { mentionable: source.mentionedUserIds });
      if (!isBlankText(text)) return text;
      const files = attachmentSummary(source.attachments ?? []);
      if (files) return files;
      const pages = source.pageCount ?? 0;
      if (pages === 0) return '';
      return pages === 1 ? 'Shared a page' : `Shared ${pages} pages`;
    }
  }
}

/** One line for the chat list and notifications: mentions read "@Sam Ortiz", line breaks go. */
export function messagePreview(
  source: PreviewSource,
  nameOf: NameOf,
  max = PREVIEW_MAX_LENGTH,
): string {
  return truncateText(collapseWhitespace(previewText(source, nameOf)), max);
}

/** What screen readers hear for a new message: "Avery Lin: Can you check the QA form?" */
export function spokenMessage(
  senderName: string | null,
  source: PreviewSource,
  nameOf: NameOf,
): string {
  const text = collapseWhitespace(previewText(source, nameOf));
  return source.kind === 'system' || !senderName ? text : `${senderName}: ${text}`;
}
