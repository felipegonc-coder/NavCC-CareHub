# Imports (server)

Import and export spec, section 3.1. The shared part (sources, plan, limits, routes' input) is in
`packages/extras/src/import-export/import/`.

## Routes

`/api/import-export/imports` (routes.ts; the import-export routes register it). Only the person
who started an import sees it: someone else's is 403, an unknown id 404.

| Route              | Body                                               | Answer                                                                          |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /`            |                                                    | `{ imports }`: the last 7 days, newest first, at most 50, without problem lists |
| `POST /`           | `startImportSchema`                                | 201 `{ import }`, `uploading`                                                   |
| `PUT /:id/file`    | the file, `application/octet-stream`, up to 100 MB | `{ import }`, `waiting`                                                         |
| `GET /:id`         |                                                    | `{ import }` with up to 1,000 problems                                          |
| `POST /:id/cancel` |                                                    | `{ import }`, `cancelled`                                                       |
| `GET /:id/undo`    |                                                    | `{ preview }`: `UndoPreview`                                                    |
| `POST /:id/undo`   | `undoImportSchema`                                 | `{ import }`, `undone`                                                          |

- `POST /`: 400 when the file name doesn't fit the source (its "File not accepted" text) or the
  server can't read that source itself (`planned: false`). 404 when the person can't open the
  page, 403 without Edit on it, without a Private space (`pageId: null`) or without the Create
  permission. 429 with 5 imports going.
- `PUT /:id/file`: the file itself, or for `planned` the zip of `plan.json` and its files that
  the Import screen made. Checked before the body is read; 409 once it's sent, 400 when it's empty
  or not the size announced (files only). The upload and the job are saved in one transaction.
- Cancel works until the import ends (409 after). Undo works for 7 days after it's done (409
  otherwise) and needs Edit on the page it went under.
- "Download as CSV" is made on the Import screen from the problems (`problemsCsv`).

## Job

`uploading` → `waiting` → `running` → `done`, `failed` or `cancelled`; `done` → `undone`.

`import-export.import` (job.ts): one at a time in each server process, 2 tries, 30 minutes. It
reads the upload in the import worker (isolate.ts, read.ts), then in one transaction checks the
destination again, writes the plan (apply.ts), saves what it made (`ie_import_items`) and marks
the import done. Cancel aborts it and the transaction rolls back (IE-11). A file it can't read
ends it with "The import stopped: <reason>. Nothing was added."

`import-export.import-cleanup`, every 15 minutes: an upload that hasn't arrived after an hour
stops its import; an import whose job ended without it (cancelled from `/api/jobs`, or lost) ends;
uploads of ended imports go.

## Undo

What the import made goes to Trash as one entry (undo.ts). Pages changed since are listed first
and stay, with the pages above them, unless "Remove them too" is ticked; a changed row keeps its
database.

## Stand-ins and known gaps

- ports.ts: pages, content, files, databases, Trash and the Create permission deny by default,
  so until they're bound every import is refused.
- ports.ts, for people, row links and dates: `findMembers` finds nobody, `timeZoneOf` gives
  America/Denver (the default time zone), `linkRows` refuses and `noteImported` keeps nothing, so
  the source's dates aren't kept yet.
- The upload waits in Postgres (`ie_import_uploads`) until the files service stores it.
- A planned zip's size isn't compared with the file's.
