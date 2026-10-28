import type { FastifyReply } from 'fastify';

/** A report as CSV, and the name of the file it downloads as. */
export type CsvFile = { filename: string; text: string };

/** Sends a report as a CSV download (`?format=csv` on the report routes). */
export function sendCsv(reply: FastifyReply, file: CsvFile) {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${file.filename}"`)
    .header('cache-control', 'no-store')
    .send(file.text);
}
