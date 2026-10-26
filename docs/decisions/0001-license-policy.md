# 0001: License policy

- **Status:** accepted (2026-10-26)
- **Context:** Care Hub is private, "all rights reserved" code. The plan allows only permissive building blocks, blocks copyleft and paid licenses, and asks for an automatic check on every pull request.

## Decision

1. **Shipped code** is every package reachable through `dependencies` (not `devDependencies`) of any workspace package, including code bundled into the web app. Allowed: `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`, `PostgreSQL`.
2. **Dev and test tools** (reachable only through `devDependencies`) may also use:
   - `MPL-2.0`, only for unmodified test tools (axe-core and `@axe-core/*`);
   - permissive licenses common in tooling and data, never copyleft: `CC0-1.0`, `CC-BY-4.0`, `BlueOak-1.0.0`, `MIT-0`, `Unlicense`, `Python-2.0`.
3. **SPDX expressions:** with `OR`, one allowed option is enough; with `AND`, every part must be allowed.
4. **Blocked everywhere:** GPL, LGPL, AGPL, SSPL, BUSL, Elastic, Commons Clause, `UNLICENSED` or "SEE LICENSE IN" from third parties, and missing licenses. Also blocked by name: `minio`, `@tiptap-pro/*`, FullCalendar Premium packages and paid UI kits.
5. **Exceptions** (for example a package with missing metadata whose license file was checked by hand) are listed in `license-policy.json` with a reason. Changing the lists or adding an exception needs a new decision record.
6. `THIRD_PARTY_NOTICES.md` lists every shipped package with its version, license and license text. CI regenerates it on `main` and the Docker image includes it.
7. Because MPL-2.0 is limited to test tools, we use Tailwind CSS 3.4 (PostCSS) rather than Tailwind CSS 4, which needs Lightning CSS (MPL-2.0), and we stay on Vite 7. We revisit this only with Felipe's OK.

## Consequences

- Every pull request fails fast if it adds a blocked or unknown license.
- A few modern tool versions are off limits until the policy changes.
