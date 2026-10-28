# Care Hub – Rebuild plan (our own code)

_Copied from the Notion plan (the source of truth) on 2026-10-26. If they differ, Notion wins. Some planning notes are kept only in Notion._

> 🧭 **Status:** Approved on Oct 26. Phase 0 (setup) is being built.  
> **Goal:** a brand-new Care Hub with no AppFlowy code in it.  
> Fictional data only.

## 1. The idea

Care Hub is a private workspace for a Customer Care team: Notion-style pages and databases, plus Messages, a Calendar, Meetings, a Claude assistant, Forms and Learning (Articulate Rise + Reach style), running on our own server. The new version does everything today's Care Hub does and keeps its look (neutral greys, black accents, dark mode, 8px corners), but every line of code is new. The old Care Hub was deleted on Oct 26, so the new one starts from zero.

## 2. Ground rules

1. **A clean start.** Builders work only from this plan. They never copy or look at code from the old Care Hub repositories, which contain AppFlowy's code. We carry over ideas, features, screens, the look and the plans. Not code.
2. **Only "use it for anything" building blocks.** Every outside library must have a license like MIT, Apache 2.0 or BSD. An automatic check blocks anything else (like GPL, AGPL or paid licenses) on every change.
3. **All rights reserved.** The code carries the copyright notice in LICENSE.

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
| 0. Setup | Repository, builder rules, automatic checks, design kit | The Care Hub app builds and passes its checks on GitHub (server setup comes later) |
| 1. Workspace | Sign-in and accounts, spaces, sidebar, pages and the editor, live co-editing, comments, search, trash, history, templates, dark mode, phone layout, nightly backups | Two people can write and share pages |
| 2. Databases and forms | All views and property types, filters, forms with logic, CSV in and out | Your trackers work like today |
| 3. Team tools | Messages, Home, reminders, Calendar with Google and iCloud, Meetings, roles and permissions, automations, analytics, status page | The team's daily work runs without the old Care Hub |
| 4. Learning | Studio, blocks, quizzes, player and My learning, then assign and track, then reviews, templates and question banks | Every Learning feature that's live today works |
| 5. Claude | Assistant, writing help, Claude fields and Learning help, all off until you switch them on | Works with your key; off by default |
| 6. Go live | Put Care Hub on the server, bring in the Learning prototype and Notion exports, invite the team | The team uses the new Care Hub |

## 5. How we'll build it

- Work is planned in waves and split into small parts. Every change is a pull request with automatic checks: tests, license check, keyboard and readability checks, and screenshots in light and dark mode. Each one is reviewed before it's merged.
- A new **Care Hub rebuild tracker**, like the Learning tracker, lists every feature with its phase and status.
- Reviews: the plan is approved once, questions come in short batches, and each phase is tested with fictional data.
- This plan is also saved in the repository, so all work starts from the same copy.

## 6. Size

- The biggest pieces are the editor with live co-editing (Phase 1) and databases (Phase 2).

## 7. Decisions

1. **GitHub:** one repository (this one).
2. **Feature list:** going with the default. Phases 1–6 as listed; Later items stay later.

## Detailed pages

- [Builder rules and tech (for the agents)](./builder-rules-and-tech.md)
- [Look and feel](./look-and-feel.md)
- [Feature list (everything the new Care Hub does)](./feature-list.md)
