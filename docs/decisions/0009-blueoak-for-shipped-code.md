# 0009: Allow BlueOak-1.0.0 in shipped code

- **Status:** accepted (2026-10-26). Changes decision 0001.
- **Context:** The server serves the web app with `@fastify/static`, which depends on `glob`. Recent `glob` versions depend on `jackspeak`, `path-scurry` and `package-json-from-dist`, which use the Blue Oak Model License 1.0.0. Decision 0001 allowed it only in dev tools.
- **Decision:** `BlueOak-1.0.0` is allowed in shipped code. It is a short permissive license (OSI approved) with no copyleft: it allows any use, including private and commercial, as long as the license text or a link reaches everyone who gets the software. `THIRD_PARTY_NOTICES.md` already includes license texts for every shipped package, which covers that.
- **Consequences:** `license-policy.json` lists `BlueOak-1.0.0` under the shipped licenses. Nothing else changes.
