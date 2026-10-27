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
