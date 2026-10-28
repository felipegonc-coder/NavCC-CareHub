# Roles and permissions

_Copied from the Notion spec on 2026-10-28. If they differ, Notion wins._

> 🔐 Phase 3, except sharing: the sharing parts (share dialog, general access, guests, groups, share links, access requests, moving pages) are part of Phase 1 · Builds on the accounts and spaces from Phase 1 · The other specs use the words defined here
>
> 🆕 **v2 (Oct 27):** sharing now lives here in full (share dialog, general access, guests, groups, share links, access requests, moving pages), matching Notion. Related: Sidebar, spaces and nested pages; Settings and members. New parts are marked 🆕.

## 1. What it's for

Decide what each person may do. A **role** sets what kinds of things someone can ever do in a workspace; **access** sets which spaces and pages they can do them on. The server checks both on every request.

## 2. Screens and states

- **Settings → Members:** name, email, role (a dropdown), joined, last active; search; filter by role. 🆕 Tabs for Guests and Groups (Settings and members spec).
- 🆕 **Share dialog** (Share at the top right of every page, database and space, and in the page menu): described in section 3 under Sharing. It's part of Phase 1.
- 🆕 **Request access screen** for people who open a link to something they can't open (section 3).
- 🆕 **Settings → Security → Share links** (Admins): every page with a live share link.
- **Settings → Roles:** each role with its number of members. A role's page lists its permissions with a one-line explanation each, and its members. "New role" starts as a copy of any role.
- **Share dialog** notes: sharing with a role, and a note when a role limits someone ("Riley's role, Viewer, limits them to Can view").
- **Access history** (Settings → Roles → History): who changed whose role or access, when, and from what to what.
- **States:** loading skeleton; after saving, "Riley Chen is now a Viewer"; errors keep the old value and say why; the No access screen from the shared rules.

## 3. Behavior and edge cases

**Words**

- **Site admin:** an account that manages accounts and the server (web address, backups, status details, keys). There's always at least one; the first account is one.
- **Member:** a person in a workspace. Each member has exactly one **role** in each workspace.
- **Access levels** on spaces, pages and databases: **Full access** (everything, including sharing and deleting), **Can edit**, **Can comment**, **Can view**. 🆕 Databases add **Can edit content** and **Only rows they're in** (Databases, section 3.12).
- 🆕 **Guest:** someone who isn't a member and can open only the pages shared with them.
- 🆕 **Group:** a named list of members, used for sharing.

**Role permissions**

| Permission | Lets the person | Admin | Editor | Commenter | Viewer |
| --- | --- | --- | --- | --- | --- |
| Edit | Change content where they have Can edit or Full access | ✓ | ✓ | – | – |
| Create | Add pages, databases and spaces; duplicate; import into a new page or database | ✓ | ✓ | – | – |
| Comment | Add comments and replies | ✓ | ✓ | ✓ | – |
| Share | Change who has access, where they have Full access | ✓ | ✓ | – | – |
| Templates | Save, change and delete workspace templates (everyone can use them) | ✓ | ✓ | – | – |
| Use Claude | Use Claude features that are switched on (see Claude features) | ✓ | ✓ | – | – |
| Build trainings | Use the Learning Studio (Phase 4) | ✓ | – | – | – |
| Assign trainings | Assign courses and paths (Phase 4) | ✓ | – | – | – |
| See training analytics | See Learning reports (Phase 4) | ✓ | – | – | – |
| 🆕 Add guests | Share pages with guests and create guest accounts (when the workspace allows guests) | ✓ | ✓ | – | – |
| 🆕 Share links | Make view-only share links (when the workspace allows them) | ✓ | ✓ | – | – |
| Admin settings | Manage members, roles, automations, analytics and workspace settings | ✓ | – | – | – |

- Everyone, in every role, can use Home, Messages, Calendar, reminders and My learning, and fill in forms sent to them.
- Built-in roles can't be changed or deleted. Custom roles: up to 20 per workspace, with unique names of up to 40 characters, and any mix of permissions except Admin settings. Example: "Trainer" = Editor plus the three Learning permissions.
- Deleting a custom role asks which role its members move to.

**How access is worked out**

1. Collect every grant that reaches the page: from its space, its parent pages, the page itself, a role the person has, or "everyone in the workspace", 🆕 a group they're in, and, for database rows, row access rules. Share-link visitors get Can view on what the link covers and nothing else. A page inherits its parent's grants unless "Stop inheriting" is on; then only its own grants count.
2. Take the highest level.
3. Limit it by the role. Without Edit, the most is Can comment (with Comment) or Can view. Without Share, Full access works as Can edit. Without Comment, there's no commenting.
- People can give access only up to their own level.
- Admins can see and manage every shared space (including limited ones) and join any of them. They can't open other people's private spaces, chats they aren't in, private events, connected calendars, transcripts or Claude chats (RP-D1: never).
- A workspace always keeps at least one Admin: the last one can't be removed or changed ("A workspace needs at least one Admin."). A site admin can make any member an Admin, even in a workspace they aren't in: Settings → Site → Accounts → the person → their workspaces → Make Admin. This is the way back in when no Admin can sign in. It doesn't add the site admin to the workspace or let them open its pages, and it's recorded in that workspace's Security log. Inside a workspace's Settings → Members, only its Admins change roles; being a site admin adds nothing there.
- Changes take effect at once. Open pages switch to the new access within 5 seconds with a banner ("Your access changed. This page is now view-only."), and live editing stops for anyone who lost it.
- Nothing leaks: search, page cards, mentions, backlinks, relation chips, notices, Home, Calendar and Analytics never show the title or text of anything the person can't open.

**🆕 Sharing: the share dialog**

- **Invite box** at the top: search members, groups, roles and guests by name; pick a level (Full access, Can edit, Can edit content and Only rows they're in for databases, Can comment, Can view); optional note; Invite. Each person reached gets a 🔔 notice with a page card ("Avery Lin shared Refund steps with you").
- **People with access:** each person, group or role with its level menu (including Remove) and where it comes from ("From Support", "From Policies"). Up to 200 entries show, then a search.
- **General access:** "Only people invited" or "Everyone in the workspace" with a level.
- **Inherited access:** changing or removing an inherited entry on a sub-page asks "Give this page its own access? It will stop following Policies." Yes copies the inherited entries onto the page and turns on Stop inheriting. "Restore inherited access" undoes it.
- **Share link** tab (below), **Copy link** (works only for people with access), and the role-limit note.
- People can only give a level up to their own, and only with the Share permission. A page always keeps at least one person or group with Full access.

**🆕 Guests**

- A guest is someone outside the team who can open only the pages shared with them (and those pages' sub-pages). They get their own account: name, sign-in name, password, and optional 2-step verification.
- Care Hub never sends email, so whoever adds a guest gets a one-time setup link (valid 7 days) to pass on another way. The setup screen reminds the inviter that the guest also needs access to the Tailscale network, which a site admin gives in Tailscale.
- Adding guests needs the Add guests permission and the workspace setting "Allow guests" (on by default; Settings and members). Up to 100 guests per workspace.
- Guests can get Can edit, Can comment or Can view, never Full access, and they can't share. With Can edit they can add sub-pages inside that page.
- Guests see a "Shared with me" sidebar section, search only what they can open, and see names only of people on pages they can open. They don't get spaces, the member list, Messages chats (🟨 RP-D2), Calendar, Meetings, Learning, Analytics, templates, automations or workspace settings. They do get their 🔔 chat, comments and mentions on their pages, and their own account settings.
- Guests show a "Guest" label wherever their name appears.
- Removing a guest ends all their access and sessions within 5 seconds; their comments stay, marked "(removed)". Admins can turn a guest into a member, which keeps their account and access and adds a role.

**🆕 Groups**

- Admins manage groups in Settings → Members → Groups: name (unique, up to 40 characters), description, members (not guests). Up to 100 groups.
- A group can be given access like a person. Adding someone to a group gives them the group's access everywhere at once; removing them takes it away.
- Roles decide what kinds of things people may do; groups are only lists of people for sharing and @mentions (Comments and mentions).

**🆕 Share links** (🟨 RP-D3)

- Care Hub's version of Notion's Publish: a view-only link to one page that anyone who can reach Care Hub on the tailnet can open without signing in.
- The page shows in a clean reader: title, icon, cover, content and a header "Shared by Avery Lin · view only". No sidebar, comments, history, page menu or editing.
- Options: include sub-pages (off by default), expiry (never, 1 day, 7 days, 30 days, or a date), allow downloads of files and pictures (on by default).
- Mentions of pages the link doesn't cover show as "🔒 A page" with no title. Databases with row access rules or property access are left out ("This database isn't shared by this link."); other databases show read only.
- One share link per page. Making one needs Full access, the Share links permission and the workspace setting "Allow share links" (on by default). Turn off stops the link at once; Change link makes a new address.
- Settings → Security → Share links (Admins): page, made by, created, expires, views per day, and Turn off. A share link is visited without an identity; only a daily view count is kept.
- A link that's off or expired shows "This link isn't active." Each link allows 60 page loads a minute per device.

**🆕 Access requests**

- A signed-in member who opens a link to something they can't open sees the No access screen (still no title) with Request access and an optional note.
- The request goes to the 🔔 chat of up to 5 people with Full access on the page (latest editors first), with a page card and buttons Give Can view, Give Can edit and Decline. The first answer wins; the others see "Handled by Sam Ortiz". The requester is told the result.
- One open request per person per page; after a decline, they can ask again in 24 hours.
- Members without the Add guests permission can "Request a guest", which goes to Admins the same way.

**🆕 Moving pages changes access**

- Moving a page somewhere with different access first shows what will change, in one sentence: "Moving Refund steps to Billing changes who can open it: 4 people lose access; the Agents group gets Can view." People who lose access are counted, each person once even if they had access several ways ("1 person loses access"). Each person, group or role that gains access or gets a different level is named with its new level, joined with "and". A part that doesn't apply is left out. Move to (Pages and blocks) and dragging in the sidebar use this same confirm. Move or Cancel. Pages with Stop inheriting keep their own access, and the confirm says so.
- Moving into a private space removes everyone else's inherited access; moving out of one gives the new place's access.
- Moving needs Full access on the page and Can edit where it's going.

## 4. Data it stores

- **Role:** workspace, name, description, built-in or not, its permissions, created and changed.
- **Membership:** person, workspace, role, joined, removed.
- **Account:** site admin or not.
- **Access grant:** space, page or database; who (a person, a role or everyone); level; given by; when. Pages also store "stop inheriting" on or off. 🆕 Who can also be a group or a guest; the level can be Can edit content or Only rows they're in (databases).
- 🆕 **Guest:** an account kind with name, sign-in name, invited by, setup link (expiry, used), turned into a member or not.
- 🆕 **Group:** workspace, name, description, members, created and changed.
- 🆕 **Share link:** page, address code, include sub-pages, expires, allow downloads, made by, created, turned off, views per day.
- 🆕 **Access request:** page, requester, note, sent to, status, answered by, when.
- **Access history:** who, what changed (role or access), before, after, when. Kept as long as analytics.

## 5. Permissions

- Only Admins change roles and manage custom roles.
- Changing a page's grants needs Full access and the Share permission.
- Site admins manage accounts and server settings, and can appoint Admins.
- 🆕 Adding guests needs Add guests and Full access on the page; share links need Share links and Full access. Admins can turn off any share link and remove any guest.
- 🆕 Groups are managed by Admins only.
- 🆕 Share-link visitors can only read what the link covers; every other request from them is refused (403).

## 6. Keyboard and phone

- Members and Roles are tables that sort and search by keyboard; each permission switch is labelled with its explanation.
- Phone: Members becomes a list (tap someone to change their role), and a role's permissions are one switch per row.
- 🆕 Share dialog: the invite box searches as you type, ↑ and ↓ pick, Enter adds; each entry's level is a menu; Esc closes and returns focus to Share. On phones it's a full screen.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests and results use the same IDs.

1. ⭐ **RP-16** Share Onboarding plan with Sam (Can edit), the group Phoenix team, the role Agent and the guest Casey (Can view), then change Sam's level on a sub-page. → Each gets the chosen level and inherited entries show their source; the sub-page change asks first and turns on Stop inheriting.
2. ⭐ **RP-03** Give Morgan, a Viewer, Can edit on a page. → Morgan can still only view, and the Share dialog says why.
3. ⭐ **RP-09** Change Sam from Editor to Viewer while Sam has a page open. → Within 5 seconds Sam's page turns view-only, with the banner.
4. ⭐ **RP-18** Sign in as the guest Casey. → Casey sees only pages shared with her and can't open others, make top-level pages or see the member list.
5. ⭐ **RP-21** Make a share link with sub-pages off, open it signed out, then Turn off the link. → The page is read only and its sub-pages are locked; afterwards the link says "This link isn't active."
6. **RP-07** Share a page with the role Agent as Can view, then add a new Agent. → Every Agent can see it, including the new one.
7. **RP-05** Turn off Create for the Agent role and sign in as Avery, an Agent. → New page, New database, Duplicate and Import are gone.
8. **RP-10** Try to remove the last Admin or change their role. → Care Hub refuses. Then Jordan, a site admin who isn't in the workspace, makes Sam an Admin from Settings → Site → Accounts. → Sam is an Admin, and Jordan still can't open the workspace's pages.
9. **RP-24** As Riley, open a link to a page you can't open and choose Request access; decline it as the owner, then ask again as Riley. → Riley never sees the title and is told the answer; asking again within 24 hours is refused.
10. **RP-25** Move a page into a space with different access. → Care Hub lists the exact changes first, and afterwards access matches the list.

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
- **RP-10** The last Admin can't be removed or changed; a site admin can appoint one from Settings → Site → Accounts, even without being in the workspace, and that doesn't let them open its pages.
- **RP-11** Deleting a custom role moves its members to the chosen role.
- **RP-12** An automated test sends every kind of request as every built-in role and gets the expected answer (allowed or 403).
- **RP-13** Leak tests: search, cards, mentions, backlinks, relation chips, notices, Home, Calendar and Analytics show nothing from pages the person can't open.
- **RP-14** An Admin's requests for someone else's private page, chat, event or transcript are refused (403).
- **RP-15** Access history records role and access changes.
- 🆕 **RP-16** Inviting a person, a group, a role and a guest each gives the chosen level; inherited entries show their source; changing one on a sub-page asks first and turns on Stop inheriting; Restore inherited access undoes it.
- 🆕 **RP-17** General access "Everyone in the workspace · Can comment" lets a member who joins later comment at once.
- 🆕 **RP-18** A guest sees only pages shared with them, can't open others (403), can't make top-level pages, can't see the member list, and can't be given Full access.
- 🆕 **RP-19** A guest setup link works once and stops after 7 days; removing a guest ends their sessions within 5 seconds.
- 🆕 **RP-20** Adding someone to a group gives them the group's access everywhere at once; removing them takes it away.
- 🆕 **RP-21** A visitor who isn't signed in sees a share-linked page read only; with sub-pages off, sub-pages and page mentions are locked; after Turn off or expiry the link says "This link isn't active."
- 🆕 **RP-22** Share links never show databases with row rules or property access, comments, or history.
- 🆕 **RP-23** The Admins' share-link list shows every live link, and Turn off works from there.
- 🆕 **RP-24** Access requests: no title is shown to the requester; the notice buttons work; the first answer wins; the requester is told; asking again within 24 hours of a decline is refused.
- 🆕 **RP-25** Moving a page to a place with different access first shows the section 3 sentence, such as "Moving Refund steps to Billing changes who can open it: 4 people lose access; the Agents group gets Can view." Afterwards access matches it: the people counted can't open the page, and those named have the stated level.
- 🆕 **RP-26** The permission test (RP-12) and leak tests (RP-13) also pass for guests, groups and share-link visitors.

## Decisions

- ✅ **RP-D1** Can Admins open other people's private spaces, chats, private events and transcripts? **Decided: the default** (no, never).
- 🟨 **RP-D2** 🆕 Can guests use Messages to chat with members? **Default:** no; guests only get their 🔔 chat.
- 🟨 **RP-D3** 🆕 View-only share links that anyone on the Care Hub network can open without signing in (Care Hub's version of Notion's Publish). **Default:** yes; Admins can turn them off for the workspace.
