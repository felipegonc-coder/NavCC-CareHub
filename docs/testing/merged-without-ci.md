# Merged without CI

GitHub Actions minutes ran out on Oct 27, 2026 (around 12:10 UTC), so no CI runs until they come back (decision 0006). Until then the Testing lead merges pull requests that change only `tests/e2e/flows/**` and `docs/testing/**` by hand, after reading every line. They're listed here, oldest first, with the head that was merged. [First full run](first-full-run.md) says how main gets checked once the minutes are back.

Each pull request below was:

- read line by line;
- type-checked (`tsc`) and checked with Prettier, in a copy of `tests/e2e` at main plus the pull request;
- checked for `.only` and `page.pause()`, for repeated test titles in a file, for any `describe` without `needs()`, and for addresses outside `@example.test`;
- run locally with Playwright and no server, in one project. Every file loads, and every check skips behind `needs()`. For #225 to #332, this run came after the merge.

None of them has run against a server yet. The features each check needs are still `false` on main, so the nightly reports them as "Not built yet" until those features land.

| Pull request | Head merged                                | Squash commit | Checks                                                                                          |
| ------------ | ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------- |
| #225         | `4568fa7815a49bb804ca1103fe016118b5a8a3eb` | `aa6ef2f`     | HT-01, HT-04, HT-05, HT-07, HT-09, HT-10                                                        |
| #284         | `886a9736575eff50de41ef71ce0f124f11a69424` | `193c5e8`     | KB-01, KB-03, KB-04, KB-05                                                                      |
| #287         | `e8eb027a8db36e786b1f9a1e5acb2b14c603a0d0` | `2fdfb2a`     | RP-05, RP-07, RP-09, RP-24, RP-25                                                               |
| #297         | `e9d7c6e386db6860a1d3e292f5278f19fb40e758` | `9563d20`     | HT-08, HT-14                                                                                    |
| #301         | `fc4202812f022ba05ed43abdb47a530543403451` | `8b37231`     | SR-06, SR-08, SR-09, SR-11, SR-14                                                               |
| #330         | `a68be5ff5349c3f7a487e305651c5350d1021e46` | `85de5f0`     | PB-05, PB-26, PB-28, PB-31, PB-36                                                               |
| #331         | `660c75bcbbd02fc6b472315e68dd71197fa09cec` | `9aa51f8`     | SB-02, SB-07, SB-13                                                                             |
| #332         | `4bab6e2009b886ca13709341be4713f0b81e97a5` | `c81db6f`     | PB-02, PB-04, PB-35                                                                             |
| #260         | `214bb903ae6a910387c3a36e6ad3fb63d087869a` | `6403afe`     | DB-09, DB-10, DB-14 to DB-16, FM-01 to FM-04, FM-08, FM-09, FM-11, FM-13, FX-02, FX-04, FLOW-02 |
| #328         | `c42a610711bcc727a91e7bd7ebdb13a0cf0fd537` | `9eef1cc`     | CM-05, CM-11, CM-12                                                                             |
| #254         | `574895fc9dd45a1db0b1f143d2dd987d5e605b4f` | `3f77a64`     | AN-01, AN-04, AN-05, SM-01, SM-06, SM-07, FLOW-05, FLOW-08, HR-02                               |
| #385         | `f7fb3627523f6c907c14a523f6b4d294ed4ea9d1` | `b1d61cb`     | SM-02, SM-03, SM-05, SM-09, SM-10, SM-12, ST-03, ST-05, ST-09                                   |
| #396         | `83d8af8e4a9e0c622f29fdd7b8c1b22a3907ba3c` | `8dda3e7`     | KB-02, KB-07, KB-08, KB-11, KB-12                                                               |
| #397         | `ca9ce68c60b7db77bb8413e3aad34567f38c5835` | `edb617b`     | FLOW-04, FLOW-07                                                                                |

Notes:

- #385: `settings/security.workspace.e2e.ts` is `fixme` until #369 adds the `workspace` project. ST-03 and ST-05 stop the test server's database or app, so they run by hand only.
- #396 and #397: KB-07 and FLOW-07 set a "Verified until" day of today or earlier. The server needs a knowledge base test hook for that, and it isn't there yet.

Pull requests that change only `docs/testing/` aren't listed.
