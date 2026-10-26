# 0011: More permissive licenses, and CI hardening

- **Status:** accepted (2026-10-26). Changes decisions 0001 (license lists) and 0006 (CI).
- **Context:** The first full license check (PR #5) found `argparse` (Python-2.0), which `markdown-it` pulls in through the editor. The security reviewer's first pass (issues #8, #9 and #10) found workflows where PR code could reach a write token, install scripts running in CI, and images that any branch could publish.
- **Decision:**
  1. Also allowed in shipped code: `Python-2.0`, `Zlib`, `Unicode-3.0`, `Unicode-DFS-2016` and `CC0-1.0`. `OFL-1.1` is allowed for font packages only. All are permissive with no copyleft; they need only their notice, which `THIRD_PARTY_NOTICES.md` carries.
  2. More paid kits are blocked by name in `license-policy.json`: Highcharts, amCharts, Froala, CKEditor premium features, GoJS, JointJS+, DHTMLX, Infragistics and Ignite UI, Nutrient (PSPDFKit), Apryse (PDFTron), GrapeCity, and `mapbox-gl` (version 2 and later aren't open source; MapLibre is fine).
  3. CI never runs install scripts: `npm ci --ignore-scripts` when the lockfile is in sync, otherwise `npm install --ignore-scripts`. Quick checks run `npm audit --omit=dev --audit-level=critical` (critical fails the run; high is listed in the report) and gitleaks (a pinned binary with its checksum checked) on the PR's commits (issue #9).
  4. Jobs that run PR code (installs, tests, builds) get `permissions: contents: read` and check out with `persist-credentials: false`. Anything that needs write access (PR comments, the screenshots branch, packages) runs in a separate job that doesn't check out or run PR code (issue #8).
  5. Only `main` publishes Docker images (`:latest`, `:sha-<short>`, versions). Pull requests and other branches build and smoke-test the image without `packages: write` (issue #10).
- **Consequences:** A license that isn't listed here or in 0001 and 0009 still fails the check, and adding one needs a new decision. A package that needs its install script must work without it in CI or get a named exception in a decision.
