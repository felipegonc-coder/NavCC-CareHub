# Care Hub – Rebuild plan (our own code)

_Copied from the Notion plan (the source of truth) on 2026-10-26. If they differ, Notion wins._

> 🧭 **Status:** Approved by Felipe on Oct 26. Phase 0 (setup) is being built.  
> **Goal:** a brand-new Care Hub with no AppFlowy code in it, that you own.  
> **Owner:** Felipe Gonçalves · Fictional data only.

## 1. The idea

Care Hub is a private workspace for Nav's Customer Care team: Notion-style pages and databases, plus Messages, a Calendar, Meetings, a Claude assistant, Forms and Learning (Articulate Rise + Reach style), running on your ThinkCentre. The new version does everything today's Care Hub does and keeps its look (neutral greys, black accents, dark mode, 8px corners), but every line of code is new. Felipe deleted the old Care Hub on Oct 26, so the new one starts from zero.

## 2. How we make sure it's yours

1. **Nav's OK in writing.** Care Hub was made for your team at Nav, and so far with tools in Nav's Notion workspace. That can give Nav a claim, even on brand-new code. A short written OK settles it (draft note in section 8). It matters most for Learning, which was planned for Nav's team.
2. **Your own accounts.** The code lives in a private GitHub repository on an account signed up with your personal email. The builders run on an account you pay for, unless Nav's OK says we may keep using this workspace.
3. **A clean start.** Builders work only from this plan. They never copy or look at code from the old Care Hub repositories, which contain AppFlowy's code. We carry over ideas, features, screens, the look, all plans and your content. Not code.
4. **Only "use it for anything" building blocks.** Every outside library must have a license like MIT, Apache 2.0 or BSD. An automatic check blocks anything else (like GPL, AGPL or paid licenses) on every change.
5. **All rights reserved.** The code is private and marked "© Felipe Gonçalves. All rights reserved." You decide later if you ever want to share or sell it.

## 3. What we're building

| Area | What it does | In the old Care Hub? |
| --- | --- | --- |
| Workspace | Spaces, sidebar, pages with a block editor, live co-editing, comments, search, templates, version history, trash | Yes |
| Databases and forms | Table, board, calendar, gallery, list, chart and form views; forms with show-if logic | Yes |
| Messages | Direct and group chats, page cards, unread counts, notifications, reminders | Yes |
| Calendar | Day, week and month; your events; Google and iCloud (two-way); dates from databases and Learning as layers | Yes |
| Meetings | Meeting notes from events, private transcription in the browser with speaker labels, Claude summary | Partly |
| Claude | Assistant panel, writing help, Claude fields, Learning help. Built switched off | Yes (off) |
| Learning | Rise + Reach for Customer Care: Studio, 28 kinds of blocks, 8 question types, assign, track, certificates, paths, reports | 110 of 168 features |
| Admin | Accounts without email, roles and permissions, automations, analytics, backups, status page | Yes |
| Look and access | Grey and black look, dark mode, phone layout, keyboard and screen reader support | Yes |

Every feature is on the **Feature list** page below, including the Learning features still marked Later. Learning's own details stay in the PRD: Care Hub Learning (Rise + Reach for Customer Care) (Notion) and the Learning feature tracker (Notion).

## 4. Build order

| Phase | What you get | Done when |
| --- | --- | --- |
| 0. Ownership and setup | Nav's OK (pending), your GitHub account and private repository, builder rules, automatic checks, design kit | The Care Hub app builds and passes its checks on GitHub (ThinkCentre setup comes later) |
| 1. Workspace | Sign-in and accounts, spaces, sidebar, pages and the editor, live co-editing, comments, search, trash, history, templates, dark mode, phone layout, nightly backups | You and Meagan can write and share pages |
| 2. Databases and forms | All views and property types, filters, forms with logic, CSV in and out | Your trackers work like today |
| 3. Team tools | Messages, Home, reminders, Calendar with Google and iCloud, Meetings, roles and permissions, automations, analytics, status page | The team's daily work runs without the old Care Hub |
| 4. Learning | Studio, blocks, quizzes, player and My learning, then assign and track, then reviews, templates and question banks | Every Learning feature that's live today works |
| 5. Claude | Assistant, writing help, Claude fields and Learning help, all off until you switch them on | Works with your key; off by default |
| 6. Go live | Put Care Hub on the ThinkCentre, bring in the Learning prototype and Notion exports, invite the team | The team uses the new Care Hub |

## 5. How we'll build it

- The same way as Learning. A lead agent plans waves and builders each take one part. Every change is a pull request with automatic checks: tests, license check, keyboard and readability checks, and screenshots in light and dark mode. The lead reviews and merges, and the ThinkCentre updates itself.
- A new **Care Hub rebuild tracker**, like the Learning tracker, lists every feature with its phase and status.
- Your part: approve this plan, answer short batched questions, and test each phase with fictional data.
- This plan is also saved in the repository, so every builder works from the same copy.

## 6. Time and cost

- Learning alone took 6 build waves. The whole rebuild is several times that, so think weeks, not days. The biggest pieces are the editor with live co-editing (Phase 1) and databases (Phase 2).
- I'll estimate the cost once we know which account the builders run on.
- The current builder window here ends Oct 30 and runs on Nav's workspace. On Oct 26 Felipe chose to start the build here anyway.

## 7. Decisions for you

1. **Nav's OK:** not confirmed yet (note in section 8). Felipe chose to start building on Oct 26.
2. **Where the builders run:** here until this builder window closes (Oct 30). After that, to decide.
3. **GitHub:** done. Private repository `NavCC-CareHub` on the `felipegonc-coder` account.
4. **Feature list:** going with the default. Phases 1–6 as listed; Later items stay later.

## 8. First step

**Building started on Oct 26 with Phase 0.** Still worth sending Nav the note below.

> Hi \[name\], I've been building Care Hub, a workspace app (pages, calendar, messages and training) for our Customer Care team. I'm now rewriting it from scratch, and I'd like to own it personally, with Nav free to keep using it. So far I've built it partly with company tools (Notion AI). Could you confirm in writing that Care Hub and its code belong to me, or tell me who I should ask? Thanks, Felipe

## Detailed pages

- [Builder rules and tech (for the agents)](./builder-rules-and-tech.md)
- [Look and feel](./look-and-feel.md)
- [Feature list (everything the new Care Hub does)](./feature-list.md)
