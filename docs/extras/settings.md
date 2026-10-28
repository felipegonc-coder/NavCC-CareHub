# Extras settings

Every setting is optional. Each feature reads its own with `readSettings(schema)` from `apps/server/src/core/settings.ts` (decision 0007, section 2.3); empty counts as unset, and a missing value switches only that feature off. Secrets live only in the server's settings file (`deploy/.env`, mode 600), and only the app container gets them. Screens show "set" or "not set", never the value.

| Setting                   | Feature | What it's for                                                                                                        | When it's missing                                                                  |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | claude  | The key for Claude features (secret)                                                                                 | Claude stays off and can't be turned on: "Claude isn't set up on this server yet." |
| `ANTHROPIC_MODEL`         | claude  | The Claude model every feature uses (CL-D1)                                                                          | The default model in `features/claude/server`                                      |
| `CLAUDE_MONTHLY_REQUESTS` | claude  | Requests per workspace per month until an Admin sets a limit in Settings → Claude (CL-D2)                            | 3,000                                                                              |
| `ANTHROPIC_BASE_URL`      | claude  | Tests only: a local stub instead of Claude. Accepted only for `http://127.0.0.1:<port>` or `http://localhost:<port>` | `https://api.anthropic.com`                                                        |

Lines for `deploy/.env.example` (#3 lists each app variable explicitly):

```sh
# Claude features (all off until an Admin turns them on). Leave empty to keep Claude off.
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=
CLAUDE_MONTHLY_REQUESTS=
```
