# Comments and mentions

_Copied from the Notion spec (https://app.notion.com/p/3d2731e99d664be08924a99106b1d8e9) on 2026-10-27. If they differ, Notion wins._

> 💭 Phase 1 · Notion parity · Depends on: Pages and blocks, Roles and permissions (sharing, built by core in Phase 1), Messages (the 🔔 chat as the inbox; Team tools lands sendNotice and a minimal 🔔 chat by Oct 28) · Used by: Databases (row pages), Knowledge base, Home and reminders

## 1. What it's for

Talking about work where it lives: comments on a page, on selected text, on a block or on a database property, with replies, reactions and resolving; suggested edits that editors accept or reject; @mentions of people, groups, pages and dates; and following pages. Every notice lands in the person's 🔔 Care Hub chat, which works as Care Hub's inbox.

## 2. Screens and states

- **Page comments:** under the title, "Add a comment…" and the page's own threads (Pages and blocks: page comments can be set to Off).
- **Text and block comments:** select text or open the block menu → Comment (or Ctrl+Shift+M). The text gets a soft highlight and the block a 💬 marker with a count in the right margin. Clicking opens the thread beside it.
- **Property comments** (row pages): hover a property → 💬.
- **Comments panel** (Comments in the top bar): tabs Open and Resolved; filters All, For me (mentions me or I took part), and Suggestions; order by position on the page (default) or newest. Each thread shows its quoted text, comments and a reply box; clicking it scrolls to the spot and highlights it for 2 seconds.
- **Composer:** text with bold, italic, strikethrough, code and links; @mentions; emoji; Attach (up to 10 files, within the Data settings limits). Enter sends, Shift+Enter starts a new line.
- **Mode menu** in the top bar for people with Can edit: Editing (default) or Suggesting. People with Can comment see "Suggesting" and can't switch.
- **States:** "No comments yet."; "No resolved comments."; sending shows the comment faded; a failed send shows "Not sent · Retry · Delete" and keeps the text; "Avery Lin is replying…" while someone types in that thread; a thread whose text was deleted shows "The text this was on was deleted." with the quote.

## 3. Behavior and edge cases

### 3.1 Threads and comments

- A thread belongs to one page and one spot: the page, a stretch of text, a block, or a row property. Text spots follow edits made by anyone. If all of the text goes, the thread stays (with the quote) and comes back to the text if an undo or a restored version brings it back.
- Comments are up to 4,000 characters. Edit your own at any time ("edited" shows). Delete your own after a confirm; if it has replies, "This comment was deleted" stays in its place. People with Full access on the page can delete anyone's comment.
- **Reactions** work as in Messages: 6 quick emoji or the full picker (with custom emoji), one of each emoji per person, up to 20 kinds per comment, and no notices.
- **Resolve:** the person who started the thread or anyone with Can edit. Resolved threads move to the Resolved tab and their highlight disappears. Reopen brings them back; replying to a resolved thread reopens it.
- **Copy link to comment** opens the page, scrolls to the spot and opens the thread.
- Duplicating pages or copying blocks doesn't copy comments. Moving a block keeps its comments.
- New comments, edits, reactions and resolves show for everyone within 2 seconds.
- Limits: 1,000 threads per page, 500 comments per thread.

### 3.2 Suggested edits

- In Suggesting mode, typing, deleting and formatting text, and adding or removing whole blocks, become suggestions: added text is underlined in green, removed text struck through in red, and a margin thread says "Suggested by Riley Chen" with Accept and Reject.
- People with Can edit accept or reject one at a time, or use Accept all and Reject all in the panel's Suggestions filter. Accepting applies the change as an edit by the accepter, noted "suggested by Riley Chen" in page history.
- Anyone who can comment can reply to a suggestion. The suggester can withdraw it.
- If the text a suggestion touches is changed or removed by someone else, the suggestion stays if it still makes sense, otherwise it closes as "No longer applies".
- Suggestions work in page content, including row pages, but not on database properties.
- An editor's mode is remembered per page.

### 3.3 Mentions

- "@" in page text and in comments opens a menu with People, Groups, Pages and Dates. Typing filters each list; people who can't open the page show last, marked "Can't open this page".
- **People:** a mention in page text or a comment sends the person a 🔔 notice with the sentence or comment and a link to the exact spot. For mentions typed into page text, the notice waits 10 seconds; deleting the mention in that time cancels it.
- **Mentioning someone who can't open the page** asks first: "Riley Chen can't open this page." Share with Can view (only for people allowed to share), or Mention without notifying.
- **Groups** (Roles and permissions): "@Team leads" notifies each member who can open the page, with the same question for those who can't. Groups of more than 50 people can't be mentioned.
- **Pages** and **dates** make inline mentions as in Pages and blocks; they don't notify anyone. Date reminders follow Pages and blocks, section 3.7.
- Mentions in duplicated, imported or template content never notify. Mentions show the person's current name; removed people show "(removed)".

### 3.4 Following and notices

- **Follow** (page menu): notices for every new comment and suggestion on the page, and at most one summary of edits per page per hour ("Sam Ortiz and 2 others edited Refund steps"). People automatically follow pages they create; Unfollow works the same way.
- People who start or reply in a thread get notices for new replies to it. "Mute this thread" stops them.
- **Notice kinds** from this spec: a mention, a reply in your thread, a comment or suggestion on a followed page, your suggestion accepted or rejected, and the hourly edit summary. Roles and permissions adds "shared with you" and access requests.
- **The 🔔 chat as inbox** (Messages): filter chips at the top: All, Mentions and replies, Following, Reminders, Requests, Unread; and Mark all as read. Comment notices have Reply, which posts straight into the thread, and Open, which goes to the spot.
- Several new comments in one thread within 5 minutes make one notice ("3 new replies in Refund steps"). If the person can no longer open the page, the notice shows "🔒 A page you can't open".
- Each person picks which kinds they get in Settings → Notifications (Settings and members).

## 4. Data it stores

- **Thread:** page, spot (page, text, block or property, with block ID and text anchors), quoted text, open or resolved (by whom, when), created by and when.
- **Comment:** thread, author, text, mentions, files, created, edited, deleted.
- **Reaction:** comment, person, emoji, when.
- **Suggestion:** page, author, kind (insert, delete, format, add block, remove block), position, content, status (waiting, accepted, rejected, withdrawn, no longer applies), decided by and when, thread.
- **Mention:** where (page and block, or comment), who or what, notified or not.
- **Following:** person, page, automatic or chosen; muted threads.
- Notices are stored as Messages notices (kind, page card, snippet, buttons).

## 5. Permissions

| Action | Needs |
| --- | --- |
| Read comments and suggestions, follow a page | Can view |
| Comment, reply, react, suggest edits | Can comment and the Comment permission |
| Resolve a thread | Its starter, or Can edit |
| Accept or reject suggestions | Can edit |
| Edit or delete your own comment | Being its author |
| Delete anyone's comment | Full access |

- Notices are checked against access when sent and again when shown. Share-link visitors never see comments.
- A direct request to comment without Can comment, or to accept a suggestion without Can edit, is refused (403).

## 6. Keyboard and phone

- Ctrl+Shift+M comments on the selected text or block. In a thread, Enter sends, Shift+Enter starts a new line, ↑ in an empty box edits your last comment, and Esc closes the thread and returns focus to the text.
- In the comments panel, ↑ and ↓ move between threads, Enter opens one, and on a suggestion Accept and Reject are the first two buttons.
- Screen readers hear "Commented text, 2 comments" on highlighted text, and "Suggested insertion by Riley Chen: within 3 days" on suggestions.
- **Phone:** comment markers become a count at the end of the block; tapping opens the thread as a bottom sheet; selecting text shows Comment in the toolbar; the comments panel is a full screen.

## Done means

Try these in the browser with fictional data. ⭐ marks what the team will notice first. Each check uses its acceptance-check ID from section 7, so tests, results and Friday's list use the same IDs.

1. ⭐ **CM-01** Select a sentence and comment on it; Sam replies. → Both see the thread within 2 seconds, and each can edit or delete their own comment.
2. ⭐ **CM-08** Type @Sam Ortiz in a page. → Sam gets one 🔔 notice with the sentence, and clicking it opens the exact spot.
3. ⭐ **CM-03** Resolve a thread, then reply to it from Resolved. → The highlight goes away, then the thread reopens.
4. **CM-05** Turn on Suggesting, delete a word and add a sentence. → Both show as suggestions; Accept one and Reject the other.
5. **CM-09** Mention Riley, who can't open the page. → Care Hub asks first; Share with Can view gives Riley access and a notice.
6. **CM-02** Comment on a sentence; Avery then rewrites part of it. → The comment stays on the sentence.
7. **CM-12** In the 🔔 chat, use the filter chips and Mark all as read, then Reply in a comment notice. → The filters and read state work, and the reply lands in the thread.
8. **CM-11** Follow a page, then mute one of its threads. → Each new comment brings a notice, except in the muted thread.

## 7. Acceptance checks

- **CM-01** Page, text, block and property comments can be added, replied to, edited and deleted; others see them within 2 seconds.
- **CM-02** A text comment follows its text through edits by another person; deleting the text keeps the thread with the quote; undo reattaches it.
- **CM-03** Resolving hides the highlight and moves the thread to Resolved; replying reopens it; only the starter and editors can resolve (403 otherwise).
- **CM-04** Reactions follow the Messages rules and notify nobody.
- **CM-05** In Suggesting mode, inserts, deletes, formatting and block changes show as suggestions; Accept and Reject work one by one and all at once; history shows "suggested by".
- **CM-06** Someone with Can comment can only suggest; a direct request to change content is refused (403).
- **CM-07** A suggestion whose text was removed by someone else closes as "No longer applies".
- **CM-08** Mentioning a person sends one notice with the snippet and a link to the exact spot; deleting the mention within 10 seconds cancels it.
- **CM-09** Mentioning someone who can't open the page asks first; Share with Can view gives access and notifies; Mention without notifying sends nothing.
- **CM-10** "@Team leads" notifies only members who can open the page; a group of 51 can't be mentioned.
- **CM-11** Following sends a notice per comment and one edit summary per hour at most; muting a thread stops its notices.
- **CM-12** The 🔔 chat filters and Mark all as read work; Reply in a notice posts into the thread.
- **CM-13** Duplicated, imported and template content sends no mention notices.
- **CM-14** A notice for a page the person can no longer open shows the locked card, and the response has no title.
- **CM-15** Everything works by keyboard and screen reader; axe finds no serious problems; the phone layout works.
