import { mentionToken, messagePlainText, personName, type NameOf } from '@carehub/team-chat';

/** The text as people read it, for Copy text and editing: mentions read "@Avery Lin". */
export function readableText(text: string, mentions: readonly string[], nameOf: NameOf): string {
  return messagePlainText(text, nameOf, { mentionable: mentions });
}

/** Back to stored text after an edit: "@Avery Lin" is Avery's mention again, if it was before. */
export function storedText(text: string, mentions: readonly string[], nameOf: NameOf): string {
  const labels = mentions
    .map((userId) => ({ userId, label: `@${personName(nameOf(userId))}` }))
    .sort((a, b) => b.label.length - a.label.length);
  let result = text;
  for (const { userId, label } of labels) result = result.split(label).join(mentionToken(userId));
  return result;
}
