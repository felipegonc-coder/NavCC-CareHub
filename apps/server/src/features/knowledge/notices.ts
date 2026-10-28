// Sends the knowledge base's 🔔 notices after the database commit. A notice that fails is logged
// (without its content) and doesn't undo the change that caused it.
import type { FastifyBaseLogger } from 'fastify';
import { sendNotice, type SendNoticeInput } from '../notices';

/** A notice to send. Without a sender it comes from "Knowledge base"; replies carry a person's. */
export type KbNotice = Omit<SendNoticeInput, 'sender'> & { sender?: string };

export const KB_SENDER = 'Knowledge base';

export async function deliverNotices(
  notices: readonly KbNotice[],
  log: Pick<FastifyBaseLogger, 'warn'>,
): Promise<void> {
  const results = await Promise.allSettled(
    notices.map((notice) => sendNotice({ ...notice, sender: notice.sender ?? KB_SENDER })),
  );
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed > 0) log.warn({ failed }, 'Some knowledge base notices were not sent');
}
