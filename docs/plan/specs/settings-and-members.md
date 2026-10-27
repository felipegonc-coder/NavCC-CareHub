# Settings and members

_Copied from the Notion spec (https://app.notion.com/p/185eb386efca44cab8a084e816736eae) on 2026-10-27. If they differ, Notion wins._

> ⚙️ Phase 1 · Notion parity · Depends on: accounts and sign-in, Roles and permissions · Used by: every spec with a setting · Related: Sidebar, spaces and nested pages; Data settings; Messages (notifications)

## 1. What it's for

One place for each person's account and preferences, and for Admins to run the workspace: members, guests, groups, invite links, spaces, security, custom emoji and the other workspace settings. It matches Notion's Settings and members, without email: Care Hub never sends email, so invites and password resets are links that people pass on themselves.

## 2. Screens and states

- **Settings** opens over the current page (Ctrl+, or the workspace switcher → Settings), with a list of sections on the left. Each section has its own address (for example `/settings/members`) so links and Back work. Esc closes it and returns to the page.
- **Sections:**
    - **Account** (everyone): My account · Preferences · Notifications · Connections (Calendar).
    - **Workspace** (Admins, unless noted): General · Members (Members, Guests, Groups and Invite links tabs; everyone except guests can see the Members tab) · Roles (Roles and permissions) · Spaces · Security · Emoji (everyone can see it) · Embeds (Pages and blocks) · Automations · Analytics · Data (Data settings).
    - **Site** (site admins): Accounts · Server · Status (Status page) · Backups (Data settings).
- Sections a person can't use aren't listed.
- **Invite link page** and **password reset page:** the screens people see when they open those links (section 3).
- **Profile card:** hovering or focusing a person's name anywhere shows their picture, name, title, local time ("3:12 PM local time") and Message.
- **States:** loading skeleton per section; saved changes show "Saved" next to the field for 2 seconds; errors name the field and keep the typed value; a section the person lost access to while open shows "You don't have access to this."

## 3. Behavior and edge cases

### 3.1 My account

- **Profile:** name (1–80 characters), picture (PNG, JPEG or WebP up to 5 MB, cropped to a circle; otherwise initials on a color), job title (optional, up to 80 characters). Changes show everywhere within 2 seconds.
- **Sign-in name:** the person's email address, used only to sign in and to match calendar guests (Calendar, Meetings). Care Hub never sends anything to it. Changing it needs the password.
- **Password:** current and new (at least 12 characters, not on the built-in list of common passwords, not the same as the sign-in name). Changing it signs out every other device.
- **2-step verification** (🟨 SM-D1): turn on with an authenticator app (scan a QR code or type the key, then enter a 6-digit code). Ten one-time recovery codes are shown once, to download or print. Turning it off needs the password and a code.
- **Forgotten password:** the sign-in screen says "Ask an Admin to reset it." An Admin (or a site admin, for Admins) makes a one-time reset link, valid 24 hours, and passes it on. Using it sets a new password and ends all of that account's sessions.
- **Devices:** every signed-in session with browser and system, "This device", signed in, last active and Tailscale address; Sign out for each, and Sign out of all other devices. Sessions end after the workspace's session length without use.
- **Leave workspace:** members can leave (the last Admin can't). Deleting an account is done by a site admin.
- **Re-check:** changing the password, sign-in name or 2-step settings, exporting, and site settings ask for the password again if the last sign-in was more than 15 minutes ago.

### 3.2 Preferences

- Appearance: Light, Dark, or Use system setting (default).
- Open on start: Home (default) or the last page opened.
- Time zone: Automatic from the browser (default) or a chosen zone. When automatic and the browser's zone changes, a banner offers "Keep America/Denver" or "Switch to Europe/London".
- Start the week on Monday (off: Sunday). 24-hour time (off).
- Reduce motion: follow the system (default), or always.
- Language: English. All wording is kept in one place so translations can be added later (🟨 SM-D3).
- Sidebar options (Sidebar, spaces and nested pages) and the keyboard shortcut list (also in Help).

### 3.3 Notifications

- The Messages settings (all messages; only direct messages, mentions and notices; or nothing; show text; browser and push notifications).
- 🔔 notices by kind: mentions and replies, and reminders and access requests, are always on; comments on pages I follow (on), edits on pages I follow (on, at most one summary per page per hour), form responses (Forms), automation messages (on).
- Pause notifications: 1 hour, until tomorrow 8:00 AM, or until turned back on. Notices still arrive in the 🔔 chat, quietly.

### 3.4 Members, guests, groups and invite links

- **Members tab:** name, email, role, groups, joined; Admins also see last active and 2-step on or off. Search; filter by role and group. Admin row menu: Change role, Groups, Reset password (makes a link), Turn off 2-step verification (for someone locked out; both actions are logged), Remove from workspace.
- **Removing a member:** confirm names what happens: they lose access to everything in this workspace at once (sessions there end within 5 seconds), their shared pages and comments stay, their automations switch off, and their private pages are kept hidden for 90 days in case they come back, then deleted (🟨 SM-D2).
- **Guests tab** (Roles and permissions, Guests): name, email, invited by, setup link used or not, last active, and the pages shared with them (titles only for pages the Admin can open; others count as "1 page you can't open"). Actions: New setup link, Turn into member (choose a role), Remove.
- **Groups tab:** create (name, description), rename, add or remove members, delete (confirm: "Pages shared with Team leads lose that access").
- **Invite links tab:** Create invite link with a role, groups, expiry (1, 7 or 30 days) and number of uses (1 by default, up to 100). The full link shows once, with Copy. The list shows role, uses left, made by, expires, and Turn off. This isn't open sign-up: only Admins make links, and they expire.
- **Opening an invite link:** someone without an account fills in name, email (sign-in name) and password, plus 2-step verification if the workspace requires it, and joins with the link's role, groups and the default spaces. Someone with an account signs in and joins. A used-up, expired or turned-off link says "This invite link isn't active. Ask an Admin for a new one."

### 3.5 Workspace settings

- **General:** name (1–65 characters), icon (emoji or a picture up to 5 MB), export all content (Import and export), and delete workspace (site admins; Data settings).
- **Spaces:** every space with kind, owners, member count, created and archived; Admins change kind, add owners, archive or unarchive, and pick default spaces (Sidebar, spaces and nested pages). Private spaces show their names to Admins, never their pages' titles unless the Admin is a member.
- **Security:**
    - Allow guests (on), allow share links (on), members can export (on; off means only Admins export), allow moving or copying pages to other workspaces (on).
    - Who can create spaces (everyone with the Create permission, or Admins only) and who can add custom emoji (everyone, or Admins only).
    - Require 2-step verification for everyone (off). When turned on, people without it must set it up at their next sign-in.
    - Session length: sign out after 1, 7, 30 (default) or 90 days without use.
    - Failed sign-ins: after 10 wrong passwords in 15 minutes an account waits 15 minutes (fixed).
    - **Security log:** sign-ins and failed sign-ins, password resets, 2-step changes, invite links made and used, guests added, share links made, exports, role changes and removals: who, what, when, from which device. Filter by person, kind and date. Kept as long as analytics (AN-D2).
- **Emoji:** custom emoji with picture, name, added by and date. Add: PNG, GIF, JPEG or WebP up to 1 MB, cropped square; name of 2–32 lowercase letters, numbers, dashes or underscores, unique. Up to 500 per workspace. Deleting one leaves its name as text where it was used.

### 3.6 Site settings (site admins)

- **Accounts:** every account on the server: name, email, workspaces, site admin or not, created, last active, locked. Create account (name, email, a one-time setup link), Reset password, Turn off 2-step verification, Lock or Unlock (locked accounts can't sign in), Make or remove site admin (there's always at least one), Delete account (only when it's in no workspace; its past work shows "Deleted account").
- **Server:** web address, push keys (Messages), the Google sign-in client (Calendar), and other keys. Secrets show as dots and are replaced, never read back.

## 4. Data it stores

- **Account:** name, picture, job title, sign-in name, password hash (Argon2id), 2-step secret (encrypted) and recovery codes (hashed), site admin, locked, created, last active.
- **Session:** account, browser and system, created, last active, Tailscale address, ends at.
- **Preferences** (per account and workspace): appearance, open on start, time zone setting, week start, 24-hour time, reduce motion, notification choices, paused until.
- **Invite link:** workspace, code (hashed), role, groups, expires, uses allowed and used, made by, turned off.
- **Reset or setup link:** account, code (hashed), made by, expires, used.
- **Workspace settings:** name, icon, security switches, who can create spaces and add emoji, require 2-step, session length.
- **Custom emoji:** workspace, name, picture, added by, when.
- **Security log entry:** workspace (or site), who, what, details, device, when.

## 5. Permissions

| Action | Needs |
| --- | --- |
| My account, Preferences, Notifications, Connections | The person themselves |
| See the member list (names, pictures, titles, roles) | Member (not guests) |
| Members, guests, groups, invite links, spaces, security, workspace settings | Admin settings permission |
| Add custom emoji | Everyone or Admins only, as set |
| Accounts and server settings | Site admin |

- Every settings change is checked on the server; a direct request without the permission is refused (403).
- Password and 2-step secrets are never sent back to any browser, including to Admins and site admins.

## 6. Keyboard and phone

- Ctrl+, opens Settings; the section list is navigable with ↑ and ↓; Enter opens a section; Esc closes Settings.
- Every switch has a visible label and its explanation; changes are announced ("Saved").
- **Phone:** Settings is a full screen: a list of sections, each opening as its own screen with Back. Tables become lists; tap a person for their actions.

## 7. Acceptance checks

- **SM-01** Profile changes show everywhere within 2 seconds; a 6 MB picture is refused with the limit.
- **SM-02** Changing the password signs out other devices; a common password and an 11-character one are refused.
- **SM-03** 2-step verification: setup, sign-in with a code, sign-in with a recovery code (which then stops working), and turning it off all work.
- **SM-04** An Admin's reset link works once within 24 hours and ends the account's sessions; no email is sent anywhere.
- **SM-05** Devices lists sessions; Sign out of all other devices ends them within 5 seconds.
- **SM-06** An invite link with 2 uses adds two people with its role, groups and default spaces, then says it isn't active; an expired link is refused.
- **SM-07** Removing a member ends their sessions in that workspace within 5 seconds and keeps their shared pages; their private pages are hidden and come back if they rejoin within 90 days.
- **SM-08** Guests tab shows titles only for pages the Admin can open.
- **SM-09** Each Security switch changes behavior at once (guests, share links, export, moving pages out, space creation, emoji), and direct requests that break them are refused (403).
- **SM-10** Requiring 2-step verification makes people without it set it up at their next sign-in.
- **SM-11** The Security log records each listed event with who, what and when.
- **SM-12** Custom emoji: upload, name rules, the 500 limit, and deleting one leaves its name as text.
- **SM-13** A non-Admin can't open Admin sections, and their direct requests are refused (403); secrets never appear in any response.
- **SM-14** Settings works by keyboard and screen reader, axe finds no serious problems, and the phone layout works.

## Decisions for Felipe

- 🟨 **SM-D1** 2-step verification with an authenticator app (Notion has it). **Default:** yes, optional for each person; Admins can require it for everyone.
- 🟨 **SM-D2** What happens to a removed member's private pages. **Default:** kept hidden for 90 days (they come back if the person rejoins), then deleted. Nobody else can open them (RP-D1).
- 🟨 **SM-D3** Languages other than English (Notion offers many). **Default:** later; English only for now.
