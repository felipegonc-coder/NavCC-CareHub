# Sidebar, spaces and nested pages

_Copied from the Notion spec (https://app.notion.com/p/e5897b49ed3c499d824cf8ede24e8204) on 2026-10-27. If they differ, Notion wins._

> 🧭 Phase 1 · Notion parity · Depends on: accounts, workspaces, Roles and permissions · Used by: every screen · Related: Pages and blocks, Search, Page history and Trash, Templates and buttons, Settings and members

## 1. What it's for

The left-hand sidebar is how people get around Care Hub: switch workspaces, open Home, Search and Messages, and find every page in a tree of spaces and nested pages. It works like Notion's sidebar and teamspaces.

## 2. Screens and states

**Sidebar, top to bottom**

- **Workspace switcher:** workspace icon and name. Menu: the person's other workspaces (click to switch), Settings, Invite members (Admins), Create workspace (site admins), Sign out.
- **New page** button next to the switcher (Ctrl+Alt+N): opens a new page with a "Add to:" picker at the top (Private by default, or a space or page).
- **Top items:** Search (Ctrl+K), Home, Messages (unread badge), Calendar. Later phases add Learning and Claude. Each can be hidden except Search.
- **Favorites:** pages the person starred, in their own order.
- **Spaces:** each space the person belongs to, with its pages as a tree. Hovering a space shows "…" and "+".
- **Shared:** pages shared with the person directly (not through a space), and their private pages they've shared with others.
- **Private:** the person's own pages, visible only to them unless shared.
- **Recent** (hidden by default): the last 10 pages the person opened.
- **Bottom:** Templates, Import, Trash, Settings, Help.

**Page tree**

- Each entry: expand arrow (only if it has sub-pages or database views), icon, title. Hover shows "…" (menu) and "+" (add a sub-page).
- Expanding a database shows its views; clicking a view opens the database on it. Rows never show in the tree.
- An expanded page with nothing inside shows "No pages inside".
- The page that's open is highlighted, and its ancestors expand so it's visible.
- Each level shows up to 50 entries, then "Show 20 more".

**Other screens**

- **Browse spaces:** every Open and Closed space in the workspace with description, members count and Join or Request to join.
- **Space settings:** name, icon, description, kind, default access for members, members and owners, permissions and security (section 3.3).
- **States:** loading shows grey bars for each section (only after 300 ms); a section with nothing in it is hidden, except Private, which shows "Add a page"; Favorites when empty shows "Star pages to keep them here." when first opened; a failed load shows Retry in the sidebar only.

## 3. Behavior and edge cases

### 3.1 Sidebar

- Width: drag its edge between 220 and 480 px; the width is saved per person. Double-clicking the edge resets it to 240 px.
- `Ctrl+\` hides or shows it. While hidden, moving the pointer to the left edge shows it over the page until the pointer leaves.
- **Customize sidebar** (right-click a section heading, or Settings → Preferences): show or hide top items, show or hide Recent, and drag sections into a new order. Saved per person and per workspace.
- Sections collapse and expand by clicking their heading; that's remembered per person.
- Badges: Messages shows unread messages and notices (as in Messages). Nothing else shows counts.
- Clicking an entry opens it. Ctrl+click or middle-click opens it in a new browser tab. Shift+click opens it beside the current page in a side panel (pages only).

### 3.2 Page tree and nested pages

- Pages nest without limit. A page's sub-pages show in the tree in the order of the page blocks in its content; reordering in either place changes both.
- **Drag and drop:** drag an entry above, below or onto another entry (onto = becomes its last sub-page), onto a space name (top level), onto Favorites (stars it), or onto Trash (moves it to Trash). A line or a highlight shows where it will land. Moving to a place with different access shows the confirm from Roles and permissions first.
- **Entry menu ("…"):** Add to Favorites (or Remove), Copy link, Duplicate, Rename (inline), Move to, Open in new tab, Open in side panel, Turn into knowledge base (Knowledge base spec), Move to Trash. The menu shows only what the person may do.
- **+** adds an untitled sub-page and opens it, with the cursor in the title.
- Renames, moves, new pages and deletes made by anyone show in everyone's tree within 2 seconds.
- Pages the person can't open never show. If someone can open a sub-page but not its parent, the sub-page shows under Shared (or under the space, at the top level) with a faint "in a page you can't open" path.
- Breadcrumbs at the top of a page (Pages and blocks) follow the same rules.

### 3.3 Spaces

- **Kinds:**
    - **Open:** everyone in the workspace can see it in Browse spaces and join it.
    - **Closed:** everyone can see that it exists, its name and description; joining needs an owner's OK (Request to join sends a 🔔 notice to its owners with Approve and Decline).
    - **Private:** only its members know it exists; owners add people.
    - Older specs say "limited" spaces; that means Closed or Private.
- Each person also has their own **Private** section, which isn't a space and can't be joined.
- **Create space** ("+" next to Spaces): name (unique in the workspace, up to 60 characters), icon, description, kind, and default access for members (Full access, Can edit, Can comment or Can view; Can edit by default). The creator becomes an owner. Who can create spaces is a workspace setting (everyone with the Create permission by default, or Admins only).
- **Members and owners:** owners manage settings and members. Members get the default access on every page in the space, unless a page has its own access. Members can be people or groups; guests can't join spaces.
- **Space permissions** (owners): who can add pages at the top level (all members, or owners only), and security switches: allow share links, allow guests on its pages, allow export, allow moving pages out of the space. They can only turn off what the workspace allows.
- **Default spaces** (Admins, Settings and members): new members join these automatically. A new workspace starts with one Open space, "General", as a default space.
- **Leave space:** members can leave Open and Closed spaces (a confirm warns about losing access); the last owner must pick another owner first.
- **Archive space** (owners): it disappears from everyone's sidebar and Browse spaces, its pages keep their links but become read-only, and Admins can find it in Settings → Spaces to unarchive. **Delete space** moves the space and all its pages to Trash (owners; confirm with the page count).
- Order: each person drags spaces into their own order in the sidebar.

### 3.4 Favorites and recent

- ☆ in a page's top bar, the entry menu, or dragging onto Favorites stars it. Up to 100 favorites per person per workspace; drag to reorder; favorites can be expanded like the tree.
- A favorite the person can no longer open disappears from the list (and comes back if access comes back).
- Recent lists the last 10 pages opened, newest first, without duplicates. "Clear recent" empties it.

### 3.5 Workspaces

- A person can belong to several workspaces. The switcher lists them with an unread dot when Messages has unread items there.
- Switching opens the last page the person had open in that workspace (or Home).
- Each workspace has its own sidebar settings, favorites, spaces and recent list.

## 4. Data it stores

- **Space:** workspace, name, icon, description, kind, default access, who can add top-level pages, security switches, default space or not, archived (by whom, when), in Trash since, created by and when.
- **Space membership:** space, person or group, owner or member, joined, added by.
- **Join request:** space, person, status, answered by, when.
- **Per person and workspace:** sidebar width, hidden or not, section order, hidden items, collapsed sections, expanded tree entries, favorites (page, position), recent pages (page, opened at), space order, last page opened.

## 5. Permissions

| Action | Needs |
| --- | --- |
| See an entry in the tree | Can view on that page (and membership for space pages) |
| Add a sub-page | Can edit on the parent and the Create permission |
| Add a top-level page in a space | Space member, and owners only if the space says so; the Create permission |
| Move by dragging | Full access on the page and Can edit where it goes |
| Create a space | The Create permission, or Admins only if the workspace says so |
| Change space settings and members | Space owner or Admin |
| Join an Open space | Any member (not guests) |
| See a Private space | Its members and Admins (Roles and permissions) |

- The tree is built on the server for each person; titles of pages they can't open are never sent.

## 6. Keyboard and phone

- `Ctrl+\` shows or hides the sidebar. Ctrl+Shift+L switches light and dark mode. Ctrl+\[ and Ctrl+\] go back and forward.
- The tree is a real tree for screen readers: ↑ and ↓ move, → expands or goes to the first child, ← collapses or goes to the parent, Enter opens, Shift+F10 opens the entry menu, F2 renames.
- Moving by keyboard: the entry menu's Move to, or Ctrl+Shift+↑ and ↓ to move an entry among its siblings.
- **Phone:** the sidebar is a full screen opened from the menu button. A bottom bar has Home, Search, Messages and New page. Long-press an entry for its menu; dragging works after a long-press, and Move to always works.

## 7. Acceptance checks

- **SB-01** A new workspace has a General space that new members join; Private, Shared and Favorites sections behave as described.
- **SB-02** Width, hidden state, section order, hidden items and collapsed sections survive a reload and are per person.
- **SB-03** Dragging a page above, below and onto another page, onto a space, onto Favorites and onto Trash each does the right thing; the order matches the parent's page blocks.
- **SB-04** Moving a page into a space with different access shows the access confirm first.
- **SB-05** A rename or new sub-page made by one person shows in another person's tree within 2 seconds.
- **SB-06** Someone who can open a sub-page but not its parent sees it under Shared, and the response has no parent title.
- **SB-07** Open, Closed and Private spaces show to the right people; Request to join notifies owners and Approve adds the person.
- **SB-08** Space owners' "owners only" top-level setting and security switches work; a direct request that breaks them is refused (403).
- **SB-09** Archiving a space hides it and makes its pages read-only; Admins can unarchive it.
- **SB-10** Expanding a database in the tree shows its views, never rows.
- **SB-11** Favorites: up to 100, reorderable, and a favorite the person loses access to disappears.
- **SB-12** The tree works fully by keyboard with a screen reader; axe finds no serious problems.
- **SB-13** On a phone, the sidebar is a full screen, the bottom bar works, and Move to works without dragging.
- **SB-14** With 5,000 pages in a space, the sidebar shows within 1 second and expanding any page takes under 300 ms.
