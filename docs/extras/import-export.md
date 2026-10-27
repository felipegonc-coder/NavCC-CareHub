# Import and export

Spec: [import-and-export.md](../plan/specs/import-and-export.md) (IE-01 to IE-18). IE-D1: files only, with no live connection to Notion. PDF is the Print view plus the browser's Save as PDF.

## Safety

Every importer and export follows these rules.

- **No new packages:**
  - HTML, Word and Evernote files are parsed in the browser with the native `DOMParser`, with the editor schema as the allowlist.
  - Markdown goes through #198's markdown-it, with HTML off.
  - No HTML parser runs on the server (parse5 would be a new package).
- **ZIP and XML:** read them with #109's reader (`@carehub/databases/xlsx`: `readZip`, `readZipEntry`, `xmlTokens`) and its limits; don't write a second parser.
  - Sizes are enforced while inflating, and the compression ratio is capped.
  - ZIP64 is refused, and entry names are never used as paths.
  - DTDs and entities are refused.
  - The spreadsheet part of that reader waits for the #212 fix.
- **Output caps:**
  - The text an import produces is counted against a total cap, including every repeat of a shared or referenced item. The default is 10 MB of text, the same as CSV.
  - Each field is capped too.
- **Isolation:** each server-side import runs in a worker thread with `resourceLimits` and a timeout.
- **History:** an import saves a version first (HT-02).

## Import

Code: `packages/extras/src/import-export/import/` (plans, limits and words), `apps/server/src/features/import-export/import/` (the job and routes) and `apps/web/src/features/import-export/import/` (the screens).

### How an import runs

1. The Import screen starts it (`POST /api/import-export/imports`, which checks Create and Can edit where it goes), then uploads the file (`PUT /api/import-export/imports/:id/file`).
2. The job (`import-export.import`, one import at a time) reads the file in a worker thread with `resourceLimits` and a timeout. The importer gives back a plan: pages, databases with their rows, files and problems.
3. HTML, Word, Google Docs, Notion's HTML export, Evernote and Confluence need the browser's `DOMParser`, so the Import screen reads them. It uploads a zip of `plan.json` and the files the plan uses, and the job checks the plan again (`planUploadSchema`, then the page schema).
4. The job writes the whole plan in one transaction under the destination, after saving a version of it (HT-02). Cancel rolls the transaction back. Undo import moves what it made to Trash as one entry.

### Importers

- An importer is `{ source, plan(input) }` (`Importer` in `plan.ts`). It gets the file's name, bytes and text, plus its entries when the file is a zip, and gives back an `ImportPlan`. It never uses the database or the network, and it never sees the destination.
- A page's text is Markdown (`{ markdown }`) or an editor document (`{ doc }`). A link or picture pointing at another item of the plan is `planLink(key)`; the job swaps it for the new page's `/p/<id>` or the file's address.
- What can't come in goes in `problems` (file, what happened, why). A file the importer can't read throws `ImportFileError`, which the summary shows as "The import stopped: …. Nothing was added."
- Server importers are listed in `importers.ts` (`SERVER_IMPORTERS`). The Import screen's importers are listed in the web folder's `importers.ts`.

### Known gaps

- Uploads are capped at 100 MB, #109's zip limit; the spec allows 2 GB. A zip can have up to 1,000 entries.
