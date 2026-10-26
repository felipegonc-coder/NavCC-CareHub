# Roles and permissions

_Copied from the Notion spec (https://app.notion.com/p/d2e6352004d64a9b93a0b3ee29ee4259) on 2026-10-26. If they differ, Notion wins._

> 🔐 Phase 3 · Builds on the accounts, spaces and sharing from Phase 1 · The other specs use the words defined here

## 1. What it's for

Decide what each person may do. A **role** sets what kinds of things someone can ever do in a workspace; **access** sets which spaces and pages they can do them on. The server checks both on every request.

## 2. Screens and states

- **Settings → Members:** name, email, role (a dropdown), joined, last active; search; filter by role.
- **Settings → Roles:** each role with its number of members. A role's page lists its permissions with a one-line explanation each, and its members. "New role" starts as a copy of any role.
- **Share dialog** (from Phase 1), plus: sharing with a role, and a note when a role limits someone ("Riley's role, Viewer, limits them to Can view").
- **Access history** (Settings → Roles → History): who changed whose role or access, when, and from what to what.
- **States:** loading skeleton; after saving, "Riley Chen is now a Viewer"; errors keep the old value and say why; the No access screen from the shared rules.

## 3. Behavior and edge cases

**Words**

- **Site admin:** an account that manages accounts and the server (web address, backups, status details, keys). There's always at least one; the first account is one.
- **Member:** a person in a workspace. Each member has exactly one **role** in each workspace.
- **Access levels** on spaces, pages and databases: **Full access** (everything, including sharing and deleting), **Can edit**, **Can comment**, **Can view**.

**Role permissions**

| Permission | Lets the person | Admin | Editor | Commenter | Viewer |
| --- | --- | --- | --- | --- | --- |
| Edit | Change content where they have Can edit or Full access | ✓ | ✓ | – | – |
| Create | Add pages, databases and spaces; duplicate; import into a new page or database | ✓ | ✓ | – | – |
| Comment | Add comments and replies | ✓ | ✓ | ✓ | – |
| Share | Change who has access, where they have Full access | ✓ | ✓ | – | – |
| Templates | Save, change and delete workspace templates (everyone can use them) | ✓ | ✓ | – | – |
| Use Claude | Use Claude features that are switched on (Phase 5) | ✓ | ✓ | – | – |
| Build trainings | Use the Learning Studio (Phase 4) | ✓ | – | – | – |
| Assign trainings | Assign courses and paths (Phase 4) | ✓ | – | – | – |
| See training analytics | See Learning reports (Phase 4) | ✓ | – | – | – |
| Admin settings | Manage members, roles, automations, analytics and workspace settings | ✓ | – | – | – |

- Everyone, in every role, can use Home, Messages, Calendar, reminders and My learning, and fill in forms sent to them.
- Built-in roles can't be changed or deleted. Custom roles: up to 20 per workspace, with unique names of up to 40 characters, and any mix of permissions except Admin settings. Example: "Trainer" = Editor plus the three Learning permissions.
- Deleting a custom role asks which role its members move to.

**How access is worked out**

1. Collect every grant that reaches the page: from its space, its parent pages, the page itself, a role the person has, or "everyone in the workspace". A page inherits its parent's grants unless "Stop inheriting" is on; then only its own grants count.
2. Take the highest level.
3. Limit it by the role. Without Edit, the most is Can comment (with Comment) or Can view. Without Share, Full access works as Can edit. Without Comment, there's no commenting.

- People can give access only up to their own level.
- Admins can see and manage every shared space (including limited ones) and join any of them. They can't open other people's private spaces, chats they aren't in, private events, connected calendars, transcripts or Claude chats (RP-D1: never).
- A workspace always keeps at least one Admin: the last one can't be removed or changed ("A workspace needs at least one Admin."). A site admin can make any member an Admin.
- Changes take effect at once. Open pages switch to the new access within 5 seconds with a banner ("Your access changed. This page is now view-only."), and live editing stops for anyone who lost it.
- Nothing leaks: search, page cards, mentions, backlinks, relation chips, notices, Home, Calendar and Analytics never show the title or text of anything the person can't open.

## 4. Data it stores

- **Role:** workspace, name, description, built-in or not, its permissions, created and changed.
- **Membership:** person, workspace, role, joined, removed.
- **Account:** site admin or not.
- **Access grant:** space, page or database; who (a person, a role or everyone); level; given by; when. Pages also store "stop inheriting" on or off.
- **Access history:** who, what changed (role or access), before, after, when. Kept as long as analytics.

## 5. Permissions

- Only Admins change roles and manage custom roles.
- Changing a page's grants needs Full access and the Share permission.
- Site admins manage accounts and server settings, and can appoint Admins.

## 6. Keyboard and phone

- Members and Roles are tables that sort and search by keyboard; each permission switch is labelled with its explanation.
- Phone: Members becomes a list (tap someone to change their role), and a role's permissions are one switch per row.

## 7. Acceptance checks

- **RP-01** The built-in roles match the table and can't be changed or deleted.
- **RP-02** A "Trainer" role made from Editor plus the Learning permissions works for its member, on screen and by direct request.
- **RP-03** A Viewer given Can edit can only view; a direct edit is refused (403); the Share dialog shows the note.
- **RP-04** Without Share, someone with Full access can't change grants (403).
- **RP-05** Without Create, New page, New database, Duplicate and Import are hidden and refused (403).
- **RP-06** Without Comment, the comment box is hidden and comments are refused (403).
- **RP-07** Sharing a page with the role "Agent" as Can view lets every Agent see it, including one added later.
- **RP-08** The highest grant wins, then the role limit applies; "Stop inheriting" removes inherited access.
- **RP-09** Changing someone's role while they have a page open makes it view-only within 5 seconds, with the banner.
- **RP-10** The last Admin can't be removed or changed; a site admin can appoint one.
- **RP-11** Deleting a custom role moves its members to the chosen role.
- **RP-12** An automated test sends every kind of request as every built-in role and gets the expected answer (allowed or 403).
- **RP-13** Leak tests: search, cards, mentions, backlinks, relation chips, notices, Home, Calendar and Analytics show nothing from pages the person can't open.
- **RP-14** An Admin's requests for someone else's private page, chat, event or transcript are refused (403).
- **RP-15** Access history records role and access changes.

## Decisions for Felipe

- ✅ **RP-D1** Can Admins open other people's private spaces, chats, private events and transcripts? **Felipe: the default** (no, never).
