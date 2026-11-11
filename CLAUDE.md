# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server (frontend only — /api calls proxy to localhost:3000)
vercel dev       # Full stack incl. serverless functions on :3000 — needed to exercise /api
npm run build    # Production build to dist/
npm run preview  # Serve the built dist/
```

There is no test runner, linter, or formatter configured. Deployment is Vercel (production: **`technomed-leave.vercel.app`** — `leave.technomed.com.au` has never resolved; set it up in Vercel + DNS and then set `PORTAL_URL`, which every email link uses); pushing to `main` deploys.

**Brent's standing instruction (1 Nov 2026): deploy without asking.** Once a change
passes `npx vitest run`, `npm run build` and the `api/` import check below, commit it
and push straight to `main` (which deploys). Do not open a pull request or wait for
approval for routine fixes. Still stop and ask first for anything that changes how
staff use the portal, touches patient data, sends real emails, or changes real
calendar events.

## Architecture

A mobile-first PWA staff portal for TechnoMed (a Tasmanian surgical device distributor). React 18 + Vite SPA, with Vercel serverless functions under `api/`. No database — **Upstash Redis (REST API) is the only persistence layer**, accessed by hand-rolled `fetch` calls to the REST endpoint rather than a client library.

### Navigation is state, not routes

`src/App.jsx` holds `{tab, sub}` in state — no router, and `react-router-dom` is no longer imported. Five tabs (`today`, `scan`, `cases`, `me`, `admin`), because a bottom bar stops being scannable past about five; `admin` is filtered out for non-admins. A tab with no `sub` renders its **hub**; a `sub` renders one screen.

Hubs (`src/pages/Hubs.jsx`) are lists of `NavCard`s, deliberately **not** nested tab bars — two competing "where am I" signals is most of what made the old eight-tab bar feel cluttered. Adding a screen means adding a `NavCard` to a hub plus a `case` in the relevant `switch`.

Screens built on `design/Shell.jsx`'s `Header` draw their own back arrow; older pages predate it and get a floating one, listed in `SELF_BACK`. If you migrate a page to `Header`, add its key to that set or it will show two.

### The app shell is a fixed frame

`#root` is exactly the height of the visible viewport with its overflow hidden,
`.tm-shell` is a flex column inside it, and `.tm-scroll` is the **only** scrolling
region. The bottom tab bar is the last child of that column, in normal flow.

It used to be `position: fixed; bottom: 0` and it scrolled away with the case
list. Fixed was not enough, and it is worth knowing why: a fixed element is
positioned against its containing block, and *any* ancestor with a `transform`,
`filter`, `backdrop-filter` or `contain` silently becomes that block — at which
point "fixed" scrolls. On iOS a collapsing toolbar moves it as well. A bar that
is simply the last row of a viewport-height column cannot be moved by either.

Three details are load-bearing:

- **`min-height: 0` on `.tm-scroll`.** A flex item's default minimum is its
  content size, so without it the middle grows to fit the case list and pushes the
  bar off the bottom of the screen instead of scrolling. That one line *is* the fix.
- **`height: 100dvh`, with a `100vh` line before it as the fallback.** On iOS
  `100vh` is the large viewport — taller than what is actually on screen — which
  is why fixed elements appeared to shift under momentum scrolling.
- **An installed iPhone draws nothing below a short viewport — so the frame
  never goes there** (`src/appHeight.js`). With the black-translucent status
  bar, iOS sizes the viewport a status bar (~59pt) short of the glass and
  paints only the canvas colour below it. Pinning to `bottom: 0` and sizing
  the frame to the screen were both tried (Brent, 6 Nov 2026) and both failed:
  the edge is short, and anything placed past it is cut off — the tab bar's
  labels vanished. Now: the frame stays `100dvh`; when installed and short,
  `tm-short-viewport` on `<html>` turns the canvas white (inline too — index.html
  sets an inline navy on `<html>` for the first paint) and sets `--tm-bar-bg`
  white and `--tm-bottom-inset: 0px`, which the tab bar reads, so the strip
  below is part of a solid white bar. Never size anything past the viewport.
- **The clock and the strip below the bar** (Brent, 6 Nov 2026, second
  report). A navy `.tm-status-cover` (height `env(safe-area-inset-top)`, over
  the top of the shell) stops scrolled content showing under the clock. And
  while the signed-in shell is up, `tm-shell-on` on `<html>` makes html *and
  body* white on a phone — the canvas alone had not been enough, because body
  was still navy and that was what showed below the tab bar.
- **A `@media print` block undoing all of it.** A viewport-height frame with
  hidden overflow clips a printout to one screen, and the case plan has `@page A4`
  rules and gets printed.

No screen inside the shell may set `minHeight: 100vh` — the region is already the
viewport minus the header and the bar, so a child demanding a full viewport makes
every screen scroll by the height of that chrome. `PinScreen` and `Success` render
before the shell and are the exceptions. `design/safeArea.test.js` asserts all of
this.

### Zoom (Brent, 6 Nov 2026)

The page holds 1:1. After repeated "page not holding size so you have to zoom
out with your fingers", the viewport has `maximum-scale=1` (stops focus-zoom
everywhere, pinch on Android) and `blockPinch` in `src/lockZoom.js` refuses
iOS pinch gestures and two-finger moves — except inside `[data-zoomable]`,
which is the scanner's "Check the detail" view, kept pinchable for reading
sticker lot numbers. `watchZoom` still straightens a stuck zoom on return.
This reverses the earlier "never block pinch" rule; the tests now assert it.

### Design system

`src/design/` is the single source for appearance and must be used by new screens:

- **`tokens.js`** — one accent (teal `#189a85`); everything else is brand navy, neutral, or semantic (warning/danger/success). The type scale is **closed**: seven tokens, used via `text('body')`. A test asserts both, because the app had grown eleven font sizes and five competing accents, and that inconsistency was most of why it read as unpolished.
- **`icons.jsx`** — hand-drawn, stroke-only, 24 grid, 1.7 stroke, round caps. The active tab is marked by stroke *weight*, not a filled variant, so the set stays one family. All are `aria-hidden` because each sits beside a text label.
- **`Shell.jsx`** — `Page`, `Header`, `Body`, `NavCard`, `Card`, `Banner`, `Button`, `EmptyState`, `Skeleton`. Hairline borders over drop shadows; `elevation` is only for things that genuinely float.

All six pages behind the hubs are migrated onto `Header`/`Page` and the token scale. Two deliberate exemptions, asserted by `src/design/consistency.test.js` rather than left implicit:

- **`clinical/PlanBlocks.jsx` and `ClinicalPlan.jsx`'s document body** keep their own palette and sizes. They exist to replicate the emailed Word document, snapshot tests lock that, and pulling them onto the app scale would break the thing they copy. Only the plan's *chrome* uses `Header`.
- **`admin/*`** still carries its own styling. The consistency test names it as outstanding rather than ignoring it.

That test also fails the build if an off-scale font size or a hardcoded brand hex reappears in a migrated page — the drift it guards against is invisible in review, because each screen looks fine on its own.

`src/pages/Cases.jsx` is the Cases tab: two readings of the bookings calendar and
a switch between them — **Calendar** (`TodayView.jsx`, day or week, everything the
calendar holds) and **Case plan** (`ClinicalPlan.jsx`, the week as a briefing).
The calendar view used to live under Kit, which is neither where anyone looked for
it nor anything to do with kit, and it meant the two views of the same week were
two tabs apart with nothing to say they were the same data.

Each keeps its own period control. That is deliberate: the switch chooses *how* to
read the week, the control inside chooses *which part*. Collapsing them into one
three-way toggle would put "Week" and "Plan" side by side as though they were
alternatives of the same kind.

The **Team leader** screen (`TeamLeader.jsx`, Kit → Team leader — moved out of
the Cases header on 4 Nov 2026, so Cases has no mode switch) is the Clinical Team Leader
field guide, ported from the co-written "TM Team Leader" artifact
(`claude.ai/code/artifact/799bedc0-…`). Three rules there:

- **`src/teamLeader/guide.js` is generated, never hand-edited.** Re-sync with
  `scripts/extract-team-leader-guide.py` and read the diff; a hand-edit is lost
  on the next sync. `guide.source.txt` holds every phrase of the artifact and
  `guide.source.test.js` asserts each one survives into the module — the guide is
  an operating procedure, and a phrase dropped in transit is a duty nobody does.
- **Inline emphasis is structured runs, never HTML.** The artifact is shared with
  the organisation and co-written, so rendering its markup would turn an edit to
  a shared document into script running in the portal.
- **The day's run-sheet is shared; the new-booking checklist is not.** The
  run-sheet is a duty rotation the team can see the state of, stored per day in
  Redis. The booking checklist is a definition of done for *one* booking, several
  of which run through it before lunch, so it is scratch state.

**All three screens poll via `useLiveRefresh` in `src/liveRefresh.js`** — a minute while
visible, nothing while hidden, and an immediate recheck on becoming visible or
regaining focus. The calendar view previously fetched once on mount and never
again, which is how the app came to be showing a case that had been cancelled for
the next day. A test asserts both use the hook and that neither sets its own
interval.

**The app must never say something the calendar does not** — by omission or by
invention. Both failure modes have happened and both were reported from the
live calendar:

- The attending rep, written into the title as `(Mat)` by `markAttendance`, was
  swallowed by the surgeon matcher (which accepts a surname buried in a longer
  string, so `Fowler (Mat)` matched Fowler and took the rep with it) and never
  displayed. `extractRep` now takes it off the title before anything else reads
  it, matching roster first names only — `(RHH)` is not a person.
- `>` was not a separator, so a title in the team's own documented convention,
  `Pt>SYSTEM>Surgeon>(REP)`, split on nothing and rendered completely blank.
- A live case was struck through as cancelled because a note *mentioned* a
  cancellation. See `isCancelled` below.

The general rule, and `leftoverOf` in `parse.js` enforces it: **the title is not
silently discarded.** Whatever no field claimed is shown as typed. It is gated to
free-text bookings — where the description carries labels, that is the record and
the title is often a placeholder like "Booking" — and both sides are tokenised by
the same function, because splitting them differently reported `C4/5` as unread
while it was on screen, and a check that cries wolf gets ignored.

**Every edit path reads plain notes** (Brent, 11 Nov 2026: Edit booking
opened with "Gupta<br>Patient: …<br>Date: …" in the surgeon box and the rest
blank). Google stores a description as HTML once it is touched in its web
page or Outlook; the cards read it through `plainDescription`, but Edit
booking's fields came from the raw text. `getCalendarEvent` now returns the
description through `plainDescription` (links kept as `text (url)`), so the
form fills and a save writes plain lines back.

**The patient's surname is stored on the event, not only inferred.** The
portal writes it to `extendedProperties.private.tmPatient` on create and on any
save that edits the surname, and `readBooking(..., { knownPatient })` uses it to
decide how many words of the title or `Pt` line are the surname. A two-word
surname without a particle ("Testa Rossa") cannot be told apart from a first
name or an operation by any rule, so it was being cut to its first word. It is
honoured only while the title or label still starts with it — a booking retyped
in Google wins. Other fields are not duplicated there: the labelled description
is already their structured record, and a second copy would drift from it.

Anything added to a case must also go into `planSignature` in `provider.js`. The
plan is only replaced when that string changes, so a field left out of it can
change in Google and never reach the screen — and the rep is added to a booking
*after* the case, which is exactly a mid-poll edit.

A cancellation reaches the app two ways. Deleting the booking needs nothing —
`singleEvents=true` means Google stops returning it. A **rename** is the common
one, because deleting leaves no record that the theatre time was held: `isCancelled`
in `parse.js` spots it — **from the title, not from a loose scan of the
description**, which is what marked a live case cancelled over a note reading
"moved from Tuesday, that list was cancelled". The title asserts what a booking
is; the description is commentary about it. A description can still mark a case
off, but only on a line of its own. Erring towards showing a cancelled case as
live is the safer failure: the case stays on the list and the team reconciles
against Google anyway. The case is kept and struck through rather than dropped,
its colour goes grey, and it is excluded from the case count. `readBooking` strips
the marker first — a title reads `{Patient} {procedure} - {Surgeon}`, so "CANCELLED
- Streets ACDF" otherwise produced a patient called Cancelled.

`src/clinicalPlan/itemKind.js` classifies what is *not* a case — leave, hours,
meeting, reminder — so the calendar can label it. Grape settles leave before any
wording does, since that is the colour this app's own approval path writes it in.
Delineation is by **hierarchy, not hue**: a case is a white card with a 5px
coloured bar, everything else sits on the page ground with a 3px one and a kind
chip. Giving each kind its own colour would put five new hues against the surgeon
colours, which are the ones carrying real meaning.

`src/pages/TodayFeed.jsx` is the home screen: a scrolling feed, not a dashboard. It surfaces today's cases, the day's flags, the signed-in user's action items and an unsubmitted-timesheet prompt. Every item is a pointer into a section — the feed never becomes a place to do work.

`src/pages/FileBrowser.jsx` serves both Resources and filed usage sheets from Dropbox, since they are the same problem. Paths are constrained server-side to the usage and resources roots (`assertAllowedPath` in `api/usage/agent.js`); without that, any signed-in user could read the whole Dropbox account. Temporary links are fetched per tap and never stored — a persisted one would be a public URL to patient data.

Session lives in `localStorage` under `tm_user` (includes the session `token`) and `tm_login_time`. `loadStoredSession()` enforces a 30-day age limit (`SESSION_MAX_AGE_MS`) on restore and re-checks every minute, matching `SESSION_TTL_SECONDS` in `api/_auth.js` — keep the two constants in step.

### Every open copy runs the newest build (Brent, 8 Nov 2026)

"There cannot be discrepancies between the two versions of the portal" — a
desktop tab left open was still running days-old code, so the phone and the
desktop disagreed about the leader. `useNewBuild` in `src/appVersion.js`
already noticed a deploy (the hashed bundle name changes); it used to only
*offer* a reload. `applyWhenSafe` now applies it: at once when the tab comes
back into view, otherwise a minute after the bar appears, put off while a
field has focus so nobody's typing is lost. The **team leader** is polled like the week
(`useLiveRefresh(loadLeader)` in `CaseWeek.jsx` — every minute in view and on
return); it used to be fetched once per week shown, so a change made on one
device never reached another that had the week open. Phone and desktop read
the same `action=leader` (`byDay`) and the same plan; layout is the only
difference allowed between them.

### Weak signal and offline

`public/sw.js` now has a fetch handler, under narrow rules written at the top of
the file: the page is **network first** (the saved copy only on failure or a 5s
stall, so a deploy is never hidden), content-hashed `/assets/` are cache first,
`/api/` is **never** intercepted, and `/vendor/` is left to the HTTP cache. The
shell is saved at install, because the first visit loads before the worker is in
control. Saved files are matched with `ignoreVary` — the server sends
`Vary: Origin` and a module request carries an Origin the install fetch did not.

**The Cases tab only ever draws the week on screen** (Brent, 6 Nov 2026:
"says nothing booked when there is"). `weekPlan` in `CaseWeek.jsx` uses the
fetched plan only when its `weekStart` is the window's, else the saved copy of
that week, else nothing — "Loading…", or "could not be loaded" with Try
again. It used to keep drawing the last week's plan until the new one came,
so every day read "Nothing booked" on hospital 5G.

Offline, the Cases tab draws from the week plan `provider.js` already keeps in
`localStorage`, with "Offline — showing data from <time>". Screens other than
Cases are split out (`src/lazyScreens.jsx`) and prefetched in the background once
signed in, so they are cached before the next dead spot. `index.html` carries a
boot message inside `#root` that offers a retry after 8s.

**Booking edits made offline are queued** (`src/offlineQueue.js`, in
`localStorage` under `tm_pending_changes`) and sent when the phone is back
online, by the person who made them, with the version marker from when they
were made — so a booking changed in Google meanwhile is refused (409) and shown
as "make the change again", never overwritten. Only Edit booking saves are
queued. Nothing that emails a distributor is ever queued.

**Bookings@ is read into Cases → Inbox by itself** (Brent, 6 Nov 2026):
`ingestBookings` in `api/calendar/today.js` runs from the Inbox, from both
daily cron jobs, and in the background whenever a signed-in person opens the
app (`action=ingest&background=1`, skipped if any check ran in the last ten
minutes — `bookings:ingest:recent`). Cards only; nothing reaches the calendar
without Accept.
**Cancellations are read too** (Brent, 9 Nov 2026: "pt Nichols on 17/11/26 has
been cancelled but the portal can't see it"). The reader returns `cancelled`
per case; `queueCancellation` turns it into a red **Cancellation** card
(`kind: 'cancel'`, id `cancel-…`, `cancels: {eventId, date, summary}`) instead
of "already on the calendar". **Cancel the booking** runs `cancelEvent` — the
same as the Cancel button: kept, CANCELLED, grey, supplier notices offered;
**Leave it booked** dismisses. A pending booking card for the same case is
dismissed; a booking already off settles the card; `reconcileQueue` settles it
once the booking is off however that happened. Seen records are `rule: 3`;
older ones that found a booking are re-read once if subject or snippet match
`CANCEL_WORDS`.
**A CANCELLED booking is read as cancelled** (Brent, 9 Nov 2026: cards for
last week's cases already CANCELLED). `bookingsOnCalendar` set `cancelled`
from `readBooking`, which has no such field, so every booking read as live;
it now uses `isCancelled`, as the week does. A cancellation card for a day
already gone is never shown: `queueCancellation` files it as `day passed`,
and `reconcileQueue` settles any still pending.

**Every bookings@ email is accounted for** (Brent, 11 Nov 2026: "Pt Bal is
in the bookings email untouched and unbooked … the portal tells me nothing
outstanding. These mistakes cannot happen"). The check reads the whole
fortnight (paged, `INBOX_SPAN_MAX` 300; it was capped at 60), and an email
from an unknown sender or a distributor is read whenever its subject or
opening words look like a case (`looksLikeBooking`, read as `OTHER_SENDER` /
`DISTRIBUTOR_REQUEST`); records set aside before this (`rule` < 4) are looked
at once more. Seen records now keep from, subject, receivedAt and a `reason`.
Under the cards, `cases/SetAsideEmails.jsx` (`action=setaside`,
`setAsideReason`) lists every email of the fortnight that did not become a
card — not read yet, unreadable, read with nothing found, distributor, not a
booking sender — likely bookings first, the rest folded, each with **Read it
as a booking** (`action=ingest` with `force: [id]`, `outcomes` says what came
of it), **Not a booking** (POST `setaside`, `reviewed`) and Open in Gmail;
then "Already on the calendar (N)" with the entry each case matched, so a
wrong match shows.
**Find an email in bookings@** (Brent, same day, Pt Bal still missing): a
search box at the top of that list (`listBookingEmails({ q })`, four months)
shows every matching email with what became of it (cards and their status) or
why it was set aside. The span is `INBOX_SPAN_DAYS` (35); a booking that
matches a case someone dismissed is no longer counted as dealt with
(`dismissed-before`). Claude's read key (`api/agent.js`) gains
`bookings-find`, `bookings-email` and `bookings-read` (a dry run of the
reader) — read-only, logged — once `TM_PORTAL_AGENT_KEY` is in the cloud
environment.
**A person's "already on the calendar" is re-checked** (Pt Bal, same day:
Calvary's email for Gupta on 2 Dec, nothing on the calendar that day, never
shown again). `reconcileQueue` now brings such a card back (`returned.was:
'onCalendar'`, `by`) when the surgeon has **nothing at all** on that day —
while the surgeon has any case that day it is left alone, since a misspelt
surname is why people say it. An email whose cards were all dismissed is
listed as `dismissed-card`, and **Read it as a booking** on it revives the
dismissed card. Find shows who marked a card and how.
Then (Brent: "always check … whether that case is already booked by back
checking with the portal itself"): a card marked **Not a booking** that is a
whole case (patient, surgeon, day ahead) is checked the same way. Either kind
comes back **once** (`checkedBack`) with a note on the card saying who marked
it and that the surgeon has nothing that day; dismissed again, it stays.
**Search** is the magnifying glass in the Cases header (`cases/CaseSearch.jsx`,
`action=search` in `api/calendar/today.js`): Google's own full-text search over
2020 to a year ahead, each hit read through `readBooking`, cases only.
**It searches the whole portal** (Brent, 6 Nov 2026: "search literally
anything"): screens to jump to (`SCREENS` / `matchScreens`, admin only for
admins), then the calendar (`action=search`), then `action=find` —
`api/_portalSearch.js`: usage scans down to a product code or lot number
(letters and digits only, so "LOT 778" finds "LOT778…"), resupplies, kits and
where they are, every tray-list line, preference cards and the Inbox. Every
word must match; a kit name alone is the kit, not its lines. Tapping goes
where the thing lives (`onOpenPortal` in `CaseWeek.jsx`). **The floating
microphone is gone** ("the team are not using it"); the voice code remains,
unreachable.

**Surnames from every reader go through `surnameFromField` in `parse.js`** —
emails, dictation, the RHH list and usage forms. It keeps a surname field whole
and drops a given name after a comma or in lower case after a capitalised
surname. Titles typed by hand use `handTypedSurnameLength` plus title/Pt-line
agreement. Never go back to "first word" (or, for usage forms, "last word").

### Messages (Brent, 6 Nov 2026: "like WhatsApp … adopt the advantages of Slack")

`api/chat.js` + `src/pages/Chat.jsx`. Channels (General, Spine, Logistics,
Theatre lists, **Portal feedback** — read by the overnight improvement agent)
and a thread per booking. A channel refreshes every 2.5s while open (push
notifications otherwise). Messages carry `files` (photos — shrunk, GIFs kept
as GIFs — video, PDF, Office, text; `FILE_TYPES`, 100 MB, only this app's blob
URLs accepted by `readFiles`), `replyTo` (a snapshot), `reactions`
(`REACTIONS`, toggled under a per-message lock, `updateMessage`), `mentions`
(`@Mat`, `@all`), and `deleted` (author only, kept as "This message was
deleted"). Typing (`chat:typing:{channel}`), "Seen by" (`chat:seen:{channel}`,
written with every read mark) and a running count per channel
(`chat:count:{channel}`, `seq` on each message — the list is trimmed at 500,
so its length is not a count). Reads use one MGET. **Search** across every
channel (`api/_chatSearch.js`, every word in text, author or file name), also
in the portal-wide search glass. **Looks like WhatsApp** (Brent, 7 Nov
2026: "more slick … icons for the chats"): each chat has a round icon
(`ChatAvatar`; an emoji from `ICON_CHOICES` or a photo through the same Blob
upload, anyone may change it — `action=icon`, Redis `chat:icons`, only this
app's blob URLs; defaults on `CHANNELS`), the list shows the last message
(`lastLine` / `lastMessages`) with time and unread badge, messages are
bubbles (yours right in `accentSoft`, unnamed, ✓✓ teal once seen; others
left with a per-person name colour, `nameInk`), a dotted wallpaper, date
chips, and a pill message bar with round attach and send (aria-labels
"Send" / "Check"). **Attachments always get through** (Brent, 8 Nov 2026: "the
portal MUST be able to accept attachments"): any file type (`FILE_TYPES` /
`fileTypeOf` in `src/chat/fileTypes.js`, shared with the server; unknown →
`application/octet-stream`, shown as a file card), a picture the browser
cannot draw is sent as it is, a screenshot can be **pasted** into the message
box and files **dropped** on the conversation, and `uploadFile` tries Blob
direct first and falls back to `action=upload` (through the function, ≤3 MB,
`put` server-side) — a failure says why. **Since 9 Nov 2026 files up to 3 MB
go through the portal first and are kept in Dropbox** (`api/_chatFiles.js`:
`/Admin/Chat Files/{YYYY-MM}/{uuid}-{name}`, served by `action=file`, a 302 to
a temporary link, answered without a session — the random id is the guard, and
only that path shape is opened). Toni's test picture had failed both ways
because Blob storage itself was hanging; Blob is now only the second route,
and for files over 3 MB. Every route has a time limit (`withTimeout`). **Attachments preview in the portal** (Brent, 9 Nov 2026: "clicking on the
image enlarges the image, rather than instantly downloading it"): a photo, PDF
or text file opens `FileViewer` (full screen, photo pinchable via
`data-zoomable`, Download its own button, ✕/Esc/tap outside closes); Word,
Excel and the rest still download. Kept files are shown from `action=file&view=1`,
streamed with `Content-Disposition: inline` only for `previewable` types —
never HTML or SVG — because Dropbox's temporary links always download. **Names and UR numbers are allowed** (Brent:
health data needed to run the business, stored safely); only a date of birth
is queried (`chatWarning`). **Archived nightly** to Dropbox
(`api/_chatArchive.js`, `job=nightly` cron at 15:27 UTC ≈ 2:30am Hobart):
`/Admin/Chat Archive/{YYYY}/{MM}/{date}/{channel}.txt` plus every attachment
under `files/`.

### Decisions — trial on Brent's login (7 Nov 2026)

**Now suggested to-dos, not a page** (Brent, 8 Nov 2026: "drag to-do lists
into the portal My To Do … I don't know who is being cc'd"). The Decisions
page and its Me card are gone; what it finds is drawn by
`pages/projects/Suggested.jsx` at the top of Kit → Projects (My To Do on a
phone), still only for `DECISIONS_USERS` (a 404 draws nothing). **Add to To
Do** makes an ordinary task (`add-task`) for the owner where that is a person
(Brent, Toni, Erin), else whoever accepts it, due today / +3 days by urgency,
the email link in its notes; **Open email** opens the thread in Gmail;
**Later** / **Not needed** as before. **Yours and theirs** (Brent, same day:
"these are all jobs for Toni … that will encroach on someone else's task"):
`mine` from the server (`ownersFor`: your own name, plus Team leader on a day
`leaderEmailOn` says you lead) gets those buttons as "For you"; everyone
else's is folded under "In other people's inboxes", grouped by owner, with
only Open email and **Not mine** (`wrong-person`: off your list, no lesson) —
nothing there puts a task on anyone's list. The portal never drafts or sends a
reply — replies are written in Gmail, where To and Cc are visible. The
description below is the engine behind it.

"I need to see this functioning before we build it and fold it into the
portal." Me → **Decisions**, shown only to `DECISIONS_USERS` (default
brenton@ alone; everyone else gets a 404 from `api/decisions.js`, like the
Treasury). One list of what is waiting on someone, each with an owner (Brent,
Toni, Erin, Team leader, Clinical team): **unanswered emails** in
`DECISIONS_MAILBOXES` (default brenton@; bookings@ — cases and loan sets →
team leader; accounts@ — invoices, sales reports, payments → Toni; admin@ —
POs, resupply, stock follow-up → Toni; purposes in `MAILBOX_PURPOSE`, given
to the review), read with the existing `gmail.readonly` grant — a thread whose last
message is from outside, from a person (`isAutomated`), 20h+ old
(`waitingOnUs`), judged by Claude with an owner, an ask, urgency and a draft
reply; verdicts cached per last message (`decisions:triage:*`), so a thread
is judged once until someone writes again. Plus **usage not sent** (last three
working days) and **bookings waiting in the
Inbox** (resupply owed was a source until 10 Nov 2026; removed with the
Still owed list). Read-only throughout: a draft is copied, never sent. Done / Later (3
days) / Not needed / Wrong person per person (`decisions:state:{email}`),
logged (`decisions:log`); "Not needed" on an email becomes a lesson
(`decisions:lessons`) given to the next review — the start of the learned
preferences. Inboxes are re-read when the screen opens and the last read is
30+ minutes old, or on Check now. Not yet: other people's queues, a cron,
POs/quotes held, Erin's or Toni's own inboxes (domain-wide delegation and
their agreement first).

### Supplier booking notices (Tasks 8/9)

`api/_bookingNotices.js` holds the rules and contacts (Redis `notices:settings`,
seeded from `DEFAULT_CONTACTS`/`DEFAULT_RULES`, edited in Admin → Notices). Every
booking route in `api/calendar/today.js` (create, save, move, cancel, delete,
accept) calls `prepareNotices`, which returns previews held in Redis for a day;
the client shows them in `cases/NoticeSheet.jsx` and confirms by id
(`action=notify`). Each draft can be unticked (not sent) or opened and its
subject and wording edited — `edits: {id: {subject, text}}` on `notify`, the
html rebuilt from the edited text through `escapeHtml`. **Recipients are never
taken from the client**; they stay as the server wrote them. A rule may be set to send
on its own. **Every confirm-to-send acts once**: `takeNotice` is a GETDEL (a failed
send is put back by `restoreNotice`), Inbox Accept claims
`bookingcand:accepting:{id}`, leave approve/decline `leave:acting:{id}`, meeting
minutes `meeting:finalizing:{id}` — each let go only if the action failed
before writing. Device Technologies are on no rule: they asked not to get booking
notices. Notices for an edit made offline and sent later are not offered.

**A supplier is judged on the booking as it now stands** (the hospital, before
or after): a case switched from Diplomat to Mariner offers Signus nothing — Brent
does not want them told about a case that is no longer theirs — and Device gets
the loan request. A cancellation is judged on the booking as it was.
**Loan-set emails are offered only for a set new to the booking** (Brent,
4 Nov 2026): on first placement, or when an edit adds that set (Diplomat →
Mariner). A list-order change, date tweak or note on a booking whose loan was
requested by hand offers nothing (`newToBooking`). Updates and cancellations
still follow requests the portal itself sent.
**The hospital's loans team is told about loan sets** (`hospitalLoanNoticesFor`,
`DEFAULT_HOSPITAL_LOAN_NOTICES`: Calvary on, RHH off): ordered, changed (set or
date), no longer coming — tracked per booking as `loanreq:{event}:hosp-CLV` so
it is said once. The auto-add card and Edit booking choose systems by button
(`cases/KitPicker.jsx`), writing the same kit line the notices read. Mariner is
offered as **Mariner MIS** and **Mariner Open** (`SYSTEM_BUTTONS`, `variantOf`
in `inventory.js`) — one Mariner said precisely; tapping either replaces a plain
"Mariner" and keeps its supply.

**A booking email is offered as a move** (`movedOnCalendar` in
`bookingSources.js`) only for the same surname and surgeon on another day
within four weeks, one such entry — and never (Toni, 5 Nov 2026, two Oakleys):
when the email is a redo / revision / return to theatre / washout (a new
operation, `NEW_OPERATION`); when the entry's day has already passed and the
email is later; or when both name spinal levels (`levelsIn`) and none are
shared. `bookingsOnCalendar` carries `procedure` for this.

### System suggestions and Brainlab billing (Brent, 3 Nov 2026)

`src/clinicalPlan/systemSuggestions.js` holds Brent's operation → system rules
(`SYSTEM_GROUPS`) and surgeon defaults (`SURGEON_SYSTEMS`): a thoracolumbar
fixation offers pedicle screw systems only, ACDF offers cervical cages, ALIF is
Catenary only, and so on. It narrows the buttons, never forbids — everything
stays behind "All systems". **Add booking** (`NewBooking.jsx`) shows the
suggested systems as buttons once a procedure is typed, and on a hand-entered
booking pre-ticks the surgeon's usual (`picks`), as Brent approved on 4 Nov.
A booking read from an email follows what the email asks for: systems it names
are applied first, so nothing is ticked over them. Northstar (Device) and
REline (Nuvasive/Globus) are in the inventory as loan-only (`mainlandOnly`).
Two filters on top (Brent, 4 Nov 2026): **Firebird and Forza XP are offered only
for JPW, and Atallah at RHH** (`ONLY_FOR`); **TM Screw Removal only when the
procedure says extension, revision or removal, and the Mariner Outrigger only
for an extension** (`ONLY_WHEN`). A revision is an add-on to its fusion, never
pre-ticked; only a booking that is nothing but a removal leads with the kit.
**Bookings from email assume the kit from the same rules** (Brent, 6 Nov 2026):
`assumedKit` falls back to `suggestSystems` when `SURGEON_PREFERENCES` has no
row — one operation and one pick only, otherwise it asks. Fowler and Atallah
at RHH: Dakota for ACDF, Reform Cervical for posterior cervical. A cervical
range with posterior screws/fusion and nothing anterior is posterior cervical,
not pedicle screws. `NewBooking` passes `fromRules: false` (its own picks).
**KT is the distributor, never a system** (Brent, 6 Nov 2026): `resolveKit`
drops "KT"/"KT Medical" from a kit line, so "KT Lonestar" is Lonestar and a
kit of only "KT" is empty — and a JPW ACDF then assumes Lonestar.

Brainlab / AIRO is navigation, not an implant system. At **RHH** TechnoMed runs
the navigation and AIRO and **bills Brainlab per case: $300 with AIRO, $250 for
navigation without AIRO** (mostly stereotactic needle biopsies and complex
cranial). At **Calvary** we do not support navigation and do not bill. Bookings
are meant to become the single source of truth on the front end (e.g. to
populate the Brainlab invoice) and usages on the back end (resupply).

### The top band (Brent, 6 Nov 2026)

"The big blue band is pretty empty." From the mock-ups he picked: `Header`
takes `art` (the logo's own tiles — `logoTiles()` in `Shell.jsx`, seeded so
the pattern never moves — scattered over the right of the band and fading
towards the title) and `logo` (`BandLogo`, `public/logo-band.png`: the
wordmark with its navy made transparent). Cases uses both; on a desktop the
eyebrow is the greeting and date (Header A), on a phone three tiles give the
week at a glance — cases this week, the day picked in the strip ("today"
on today, else e.g. "Tue 22"), who leads that day (Header C,
`data-glance`; tests look past it for cards and the leader chip).
Revised the same day: on a phone the band has **just the tile mark**
(`BandMark`, `public/logo-mark.png`) and no scattered tiles ("too busy");
the header's search, span toggle and week arrows are **solid** (`navySoft` /
`navyDeep`), never see-through over the tiles; the **Mine** button is gone
("I don't think it helps" — `onlyMine` stays for the projects' use only).
Then (same day, after several rounds): the phone band's tiles are a
**burst in the top-right corner** on a tidy grid (`cornerTiles` in
`Shell.jsx`, `art="subtle"`) — "I don't like the tiles randomness" — embossed
like pressed tin (`EMBOSS`, `tinFace`) in the logo's colours, clear of the
controls, sizes varied like the mark (an occasional double tile near the
corner), and placed below `env(safe-area-inset-top)` — on an iPhone the band
runs up under the clock, which hid the top rows. "Overhaul it to make it look slick": every control on the band is
solid and raised (`RAISED` in `CaseWeek.jsx` — hairline highlight, soft
shadow, no see-through fills); the glance cards are solid `navySoft` with teal
labels; the chosen day in the strip is a solid teal tile, not a tint and an
underline. Check the band in a real browser render, not a mock.

**Case cards, face lift** (Brent, 6 Nov 2026: "a bit basic … make it look
nice and slick"): the surgeon's colour still fills the card (`backgroundColor:
fill` — the parity tests hold it) under a white sheen and a soft shadow
(`CARD_SHEEN`, `CARD_SHADOW`, radius 18). The patient leads at `title` size
with the surgeon as an uppercase tag on the right; the operation is one line
at body/600; each system is a chip (`chipOn(ink)`) with its supply; the list
place is an outlined badge; the rep or planned rep shares the footer row with
the list-order and copy icons (so it sits outside the card's tap target —
tests find the card by `data-case-card`).
**Nothing in a card is absolutely positioned** — a visually-hidden span did
that once, escaped the frame, made the document taller than the screen, and
iOS scrolled the page itself, pushing the tab bar's labels off the bottom
("the options on the tab are hidden"). `wash.test.js` guards it; check
`document.documentElement.scrollHeight === innerHeight` in a real render.
**Compact cards** (Brent, 9 Nov 2026: "still pretty busy … could the tiles
be any smaller?", approved from a before/after mock-up): about 110px a case
instead of 160–190. The patient is `heading` size; the list place
(`shortPlace`: "2nd · AM"), ETBS and In situ? are pills on the footer row
with the rep and the icons, not a row of their own; supplies read
"Diplomat · Cons" (`cardSupply` shortens only Consignment); radius 14,
6px between cards, icon buttons 40×34. The week column is unchanged.

### Cases layout (Brent, 4 Nov 2026)

Calmer page, as approved from a mock-up: the header is pinned (`Header sticky`)
so the week arrows never scroll away — one set of arrows, not a second
floating set; no summary line under the title; on a desktop week the blue date
strip is gone because the column headings are the dates (clicking one picks
the day + Booking adds to); **+ Booking / + Task / Inbox** are one row
(`ActionRow`); card actions are one row of icons (★ preferences, ⇅ list order,
⧉ copy).

**Within a hospital, each surgeon's cases are kept together** (`bySurgeon` in
`buildWeekPlan.js`), surgeons in the order their first case starts, each list
in its own clock/running order — two theatres running at once (JPW and Ibbett
at Calvary) are two lists, not one interleaved by time.

**A day's chip says "On leave" only on the days that person is away** (Toni,
8 Nov 2026: Ben read as on leave Tue 3, Wed 4 and Fri 13 because his leave ran
Thu 5 – Mon 9; `isAway` in `TeamLeaderStrip` now checks `away[].days`). Leave
comes from the Staff Leave calendar (`STAFF_LEAVE_CALENDAR_ID`), read with the
bookings calendar.
**The team leader is per day, under each weekday's date** (`TeamLeaderStrip`
with `day`). The chip's sheet changes **this day only** unless "Their whole
turn" is chosen. Day overrides are `teamLeader:day:{date}` (`getDayLeaders` /
`setDayLeader`), set by POSTing with `&day=`.

**A turn runs Friday to Thursday** (Brent, 5 Nov 2026: the handover is on the
Friday so the new leader can get their head around the following week's
cases). `turnOf(date)` is the Friday a turn starts; turns are stored under it
(`teamLeader:{friday}`) — the old Monday keys are no longer read. Ben's turn
**Roster set by Brent, 8 Nov 2026:** Brent Fri 6 – Thu 12 Nov (`COVERS`), **Mat
from Fri 13 Nov** (`ROTATION = [mat, ben]`, `ROTATION_ANCHOR` 2026-11-13), then
Ben, alternating. Over the Christmas shutdown the on-call person leads
(`HOLIDAY_LEADS`: Aimee 23–26 Dec, Ben 27–30 Dec, Mat 31 Dec – 3 Jan), applied
per day in `leadersOn`. Turns or days saved in the portal **before**
`ROSTER_SET_AT` (from 6 Nov on) no longer override this (`savedStillStands`);
anything saved after does, so swaps still work.
**The band's "leading" tile is tappable** (Brent, 7 Nov 2026): it opens the
same sheet as a day's chip (`TeamLeaderStrip sheetOnly`) for the day on show,
weekends included — `action=leader` returns `byDay` for all seven days and
accepts a one-day change on any of them, so a weekend follows its own turn,
never Monday's. `api/_leaders.js` is the one answer to "who leads on this day" — day change,
then the turn's saved entry, then `COVERS`, then the rota — used by
`?action=leader` (returns `byDay` for Mon–Fri, each with its `turnLeader`,
because a Monday-to-Friday week spans two turns), by `canAllocate`, and by the
morning unsent-usage escalation (`leaderEmailFor`). A whole-turn POST carries
`from` (the day whose chip was tapped) to say which turn.

### Case summary (Toni, 4 Nov 2026)

`src/clinicalPlan/caseSummary.js` turns a case into the labelled lines of a
booking description (Patient, Date, Hospital, Surgeon, Procedure, Kit, List,
Brainlab, Planned reps, Attended, Notes), for pasting into an email or chat.
It sits behind the **Copy** icon on every week and day card, which adds the
hospital and day the card leaves out. The summary card that was on Edit booking
was removed (Brent, 4 Nov 2026). **What is copied is exactly Patient, Date,
Hospital, Procedure, Surgeon, Kit** (`COPIED`) — no reps, notes, list order,
status or Brainlab/AIRO, which is enabling technology and never under Kit.
It includes the patient surname — that is what it is for.

Edit booking's top is two compact rows — Date | Hospital, Patient | Surgeon
(`TOP_FIELDS`) — under a title of "Patient · Surgeon", so procedure and kit are
on a phone's first screen.

### Registrar text (Brent, 4 Nov 2026)

After filing a usage, **Send to the registrar** is a small form
(`scan/RegistrarText.jsx`) that writes a plain text — Patient, Consultant,
System, one line per screw (`T12 Left: 6.5 x 45mm`), Rods, Cross connector,
Bone graft, Cages — and **never** reference codes or lot numbers
(`registrarDraft` / `registrarMessage` in `src/usageText.js`). The levels come
from the booking: `markAttendance` now also returns the matched booking's
procedure and kit (`booking`), and `levelsFrom` expands "T12-L2" to T12, L1,
L2. A blank side is left out. Rods, graft, cages and a cross connector are
pre-filled from the scanned items, sizes only. **Screw lines are for screw
fixation only** (Brent, 9 Nov 2026: pedicles and lateral masses, "NOT for ACDF
or ALIF"): `isScrewFixation` — posterior screw words win (pedicle, lateral
mass, PSF, PLIF, TLIF, posterior, S2AI, percutaneous, extension), an anterior
operation alone (ACDF, ALIF, corpectomy…) gets no level rows even when its
booking says "fixation" for the plate; "+ Add screw levels" brings them back. Consultant titles are guessed
only where known (`SURGEON_TITLES`). Still a draft for the phone's messaging
app, never a send.

### A usage line must carry its code and size (Brent, 9 Nov 2026)

"The portal should have picked up the missing size of the rods before he sent
it" — a case's rods were added in Amend as "Diplomat curved rods · 105" with
no code (Amend's add form had no code box), and Signus could not resupply from
it. `itemGaps` in `src/usageItemCheck.js` (shared) works from **`LINE_RULES`**,
one row per kind of item, first match wins (Brent, same day: "there is no size
per se for a tulip, so I don't want the usage stopped for these items"). Every
line wants a **product code** (flagged, but always sendable — "Resolve without
a code"). Only screws (incl. "w/o tulip"), rods, plates and cages are
**stopped** for a size, and only when there is no code either — a code already
says the size. Tulips, set screws/caps/nuts, cross links, K-wires and grafts
never need a size; anything matching no row needs a code only. Add a kind by
adding a row, specific before general. On a scan `normaliseItem` adds them to
`reviewReasons`, so the line goes to review; the review card says "Still
missing …", a rod/screw with no size cannot be resolved, and a line with no
code resolves only as **"Resolve without a code"**. Amend has a **Product
code** box; lines the amendment adds or changes are checked (`amendGaps`), the
preview lists them, Send correction is disabled, and the server answers 409
`gaps` unless `confirmGaps` ("Send without them"). `suggestedCode` offers the
Signus Diplomat titanium rod code from shape and length — AB0955-00{len}
curved, AB0855-00{len} straight — as a button, never filled in by itself.

### Amending a sent usage (Aimee and Brent, 4 Nov 2026)

**Amend** on each past usage (`scan/AmendUsage.jsx`) edits the items — change a
quantity, remove one, add one that was missed — then `action=amend`:
`preview: true` returns per-distributor change lines (`changesByDistributor`
in `api/_usageAmend.js`); without it the corrected record is saved with an
`amendments` entry, the corrected internal sheet is filed in Dropbox **beside**
the original (`…_amended_{n}.xlsx`, never over it), and a correction goes **only
to the distributors whose items changed** — subject "CORRECTION – {case}", body
"Correction — this replaces the usage sent on {date}. Added: …", corrected
sheet attached. Known items keep what the scan read; new items go through
`normaliseItem` like a scanned one, unless the rep picks the distributor.
`testOnly` sends to the signed-in person only and saves nothing.

### Neurophys, a draggable Edit booking, and kit moves for a case (Toni, 4 Nov 2026)

- **Neurophys** is offered (shown first, never auto-sent) on any **Dubey posterior
  spine case at Calvary**: rule `neurophys-dubey-clv` in `api/_bookingNotices.js`.
  A rule may now match by `surgeon` (+ `posterior`, via `isPosteriorSpine`)
  instead of `distributor`, and carry an `ask` line for a new booking. Added to
  saved settings by the `neurophys-dubey-2026-11-04` correction (`addRules`).
- **Edit booking on a desktop** (`useIsDesktop`) is a floating panel over an
  undimmed, still-usable week, dragged by its title bar. A phone keeps the sheet.
- **Move a kit** offers the week's upcoming cases using that kit
  (`casesUsingKit` in `tasks.js`); picking one sets To to its hospital, pulls
  the day back to the case's day if later, writes `Case: Gupta · Calvary · Wed
  11 Nov` (never the patient) and stores the booking id as
  `extendedProperties.private.tmCaseId`.

### Projects workspace (Brent, 4 Nov 2026)

`pages/projects/Workspace.jsx` replaced the Projects / Mine tabs (tabs are now
**Projects and tasks** and **Capture a meeting**). From the approved mock-up:
four numbers that are filters (my open, overdue, next 7 days, unassigned),
division chips, Only my tasks, Show done, a project rail with progress rings
(sticky left on desktop, a strip on a phone, "Board" opens a project's own
board), and three views — **List** (default, by project), Board (by state),
People (each person's load). Your rows have a teal edge and "You"; others show
initials in their division's colour (`DIVISION_TINT`). Projects carry a
`division` (`DIVISIONS` in `projects/model.js`, set on New project and in the
board header); a task's division is its project's, else its assignee's
(`divisionOf`). **Revised 6 Nov 2026** (Brent: spine tasks were filed under
CMF because Mat owns them): a task's own words decide first —
`divisionFromText` / `DIVISION_SIGNS` in `projects/model.js` read spine
systems (from `INVENTORY`), spine distributors, surgeons by service
(`SURGEON_SERVICES`) and operations; Stryker / KLS / CMF / max-fax words; ortho
words (`\bortho\b`, so Orthofix stays Spine). One area named wins over the
project; two named is left to the project. The assignee is used last, and
never for somebody with `acrossDivisions` in `staffConfig.js` (Mat). The one-line add takes `@Name`, and `add-task` now honours
`projectId` (it was dropped, so tasks typed on a board landed in General).
View, division and Only-mine are remembered per browser (`tm_projects_view`).
**From the 6 Nov mock-ups Brent picked** (Projects & To Do canvas): on a
phone the page opens on **My To Do** (`projects/MyToDo.jsx`, `phoneTab` in
the same prefs) — your open tasks as Overdue / Today / This week / Later /
No date, then Done today (from `doneAt`), one-tap check-boxes (`tick`), a ring
for today; tapping a to-do opens the task sheet, where its notes are. The
Projects tab beside it is the workspace as before. On a desktop the List view
is the **Table** (Desktop A): a column header per project group, the status
as a full coloured cell, priority, notes count, and the group's done/under-way
bar.
**Add a to-do by voice** (Brent, 11 Nov 2026): a microphone at the front
of the quick-add (`projects/VoiceTask.jsx`, shown only where `MediaRecorder`
exists). Tap, speak, tap again (30s cap); the recording goes to the existing
`action=voice` reader, and a `todo` reply (else the words said, `voiceDraft`)
fills the box, who and due date, with "Heard: …" beneath. Nothing is added
until Add is tapped.
**A phone's Projects page, de-cluttered** (Brent, 6 Nov 2026: "way too
busy"): a compact band (no eyebrow or subtitle); one row of three tabs in
`Projects.jsx` — My To Do · Projects · Meeting — replacing the two nested rows
(it owns `phoneTab` and passes it to `Workspace`); on the Projects tab the
four counts, the division chips, Only mine and Show done fold behind one
**Filter** button, and the quick-add shows its who/when/Add only once
something is typed. Tests open the filter with `openFilters()`.

**Cases page, less in the way** (Brent, 6 Nov 2026): a ticked task or a done
project item is no longer drawn on the Cases page at all (`openTasks` /
`undoneDue` in `CaseWeek.jsx`) — "done and gone"; the record stays on the
event and the task sheet. The day heading stacks date over the count with the
leader chip beside it, so the chip no longer wraps to a row of its own.
**A case put in a place on a list moves the rest down** (Brent, 8 Nov 2026: a
trauma add-on booked 1st on Fowler's RHH list; the others stayed 1st and 2nd).
`makeRoomOnList` in `api/calendar/today.js` runs on a new booking, on Edit
booking when the place (or day) changes, and on the list-order control: same
day, same surgeon, same hospital, and the same session unless one has none —
whoever holds the place goes down one, and on until the first gap
(`makeRoomFor` in `listPlace.js`). Each move rewrites that booking's List line.
**A case moving within its own list reorders it** (Brent, 9 Nov 2026: two
cases, the 1st set to 2nd pushed the other to 3rd). When the case was already
on that list (same day and session), `moveWithinList` moves only the cases
between its old and new place one step towards the gap — so the other comes
up to 1st. A new arrival, or a move from another day or session, still uses
`makeRoomFor`.
**ETBS on an RHH case** (Brent, 8 Nov 2026: "just extra information I want
to show on the case tab like the list order arrows" — not a Brainlab choice,
not billed). An "ETBS: Yes" line in the description (`etbs` label,
`src/clinicalPlan/etbs.js`), set by an ETBS button on New booking and Edit
booking when the hospital is RHH, read by `readBooking` as `etbs`, in
`planSignature`, and drawn beside the list place on both cards.
**What is in situ is flagged** (Brent, 9 Nov 2026: "extension or connection
to existing construct … flag this so that the team leader searches for the
previous booking in Dropbox … will be automated once the Dropbox files are
fully redacted"). `inSituReason` in `priorImplants.js` (extension, connection
to existing, existing construct/hardware, revision, removal / R/O, adjacent
segment, in situ — not "previous"/"prior" alone, which notes use about days)
reads the title, operation and notes; the case carries `inSitu`, the day gets
a red boxed flag ("Check what is in situ — … team leader to find the previous
usage in Dropbox"), and both cards an **In situ?** tag. Not for cancelled or
not-required cases. The automatic lookup (`priorImplantsFor`) stays behind the
usage-read lock.
**Not when the booking already says what is in there** (Brent, 9 Nov 2026):
`inSituNoted` — one line of the operation or notes that says it is already in
(in situ, existing, old/previous construct …) *and* names a system or maker
("Existing System - Diplomat as per …", "Stryker Tritanium cages in situ") —
and there is no day flag and no tag. The kit line never counts: it is what we
are bringing.
**The list view names every case ahead of ours it knows** (`rowsFor` in
`ListOrder.jsx`): from the List line's words, else a note starting "After …"
(`aheadWords`). Fewer named than the gap: the named ones numbered, then "N
more not ours"; more named than the hospital's number allows: listed
unnumbered. Only words nothing recognises fall back to a count, with the words
beside it — two craniotomies and two carpal tunnels are very different waits.

### TM loan kits are sent ahead (Brent, 5 Nov 2026)

When a case takes a **TM Loan** kit — written on the booking, or the
portal's own suggestion (the second Dakota at Calvary on a day) — the week
shows a dashed task on the **dispatch day: the last weekday at least two
days before the case** (Tue 24 → Fri 20; Mon/Tue → the Friday before):
"Send the Dakota TM loan kit to Calvary · for Ibbett · Calvary · Tue 24 Nov".
Worked out from the bookings every time the week is built
(`tmLoanDispatches` in `src/clinicalPlan/dispatch.js`, counting consignment
sets per site per day in list order exactly as `withDaySupplies` does) —
never written to Google by itself, so a moved or cancelled case takes it with
it. The week fetch reads **four days past the week** (`aheadOf` in
`provider.js`, `DISPATCH_AHEAD_DAYS`) so Friday can see next Monday–Thursday.
Tapping it opens Add a task prefilled (Move a kit, the kit, TM Office → the
hospital, the case); once a real Move a kit task for that kit and hospital
exists before the case (`alreadyTasked`), the suggestion steps aside. Hospitals
are compared by `siteCode` — the plan carries full names.
**A kit borrowed from the other hospital is a transfer the working day
before** (Brent, 6 Nov 2026: two Lonestar cases at RHH, one set there):
`tmLoanDispatches` also returns `kind: 'transfer'` for a Calvary Loan / RHH
Loan (and for a "Consignment" past the sets on that shelf), dated
`transferDay` — "Transfer the Lonestar kit from Calvary to RHH". The Inbox
numbers same-day cards per kit and hospital (`kitOrderOnDay`) and passes
`nth` to `assumedKit`, so the second card arrives as Calvary Loan. `planSignature` now
includes each day's tasks, so a dispatch appearing, or a task ticked in
Google, reaches the screen.

### Tasks are done once, everywhere

Tapping a calendar task opens `cases/TaskSheet.jsx`; it no longer ticks on the
spot. `taskdone` then runs `settleTask` (`api/_taskDone.js`): copies of the same
task (same words, same "For") within -30/+60 days get the same state, and open
project items that are the same task (same person; identical words or 0.8
similarity) are closed — and reopened on undo, from the ids it recorded. A
project item ticked on the Projects page ticks its calendar copies the same way.
`settleCopies` in `tasks.js` also shows a copy as done in the week view when a
twin is done. Exact words for calendar copies: the same trip written on two
days may be two trips.
**Unticked day jobs carry over** (Brent and Toni, 10 Nov 2026: "they should
carry over if not completed"). `action=opentasks` in `api/calendar/today.js`
reads TASK: events from the last `CARRY_DAYS` (60) days before today that are
not done (`carriedTasks` in `tasks.js`); `CaseWeek` polls it with
`useLiveRefresh` and puts them in front of today's jobs (`withCarried`), red,
"overdue, was Mon 3 Nov". They stay on their own day in Google; ticking one
from today ticks that event and both lists reload.

### Review fixes (6 Nov 2026)

Small rules from the full review, each with a test:
- **Loan-set update on a change of set**: `loanRequestsFor` sends an update
  when the sets asked for change (`setChanged`), not only date or hospital.
- **Timesheet resubmission** replaces only a `DRAFT` or `REJECTED` Xero
  timesheet (PROCESSED is paid), and `existingTimesheet` reads every page.
- **Amend** keeps the case's `folderName`, re-reads the record before saving,
  and sends a correction only to distributors that had the usage; others get
  `needsFirstSend` and are sent the usage from the case.
- **Resupply save** lets the claim go if saving fails; the PDF is uploaded
  with `keep: true` (Dropbox adds " (1)") so a resupply never overwrites one.
- **Self-funding quotes** save each heads-up as it goes (`persist`), and a
  quote drafted in a pass counts for `alreadyQuoted` in the same pass.
- **The daily crons** start PO/quotes/inbox work alongside the reminders and
  wait for it only until 50s in; `ingestBookings` holds `bookings:ingest:lock`.
- **Preference cards** claim each version (`prefs:claim:{n}`); **tray-list
  edits** take `kits:list:lock:{kit}` — no lost update between two editors.
- **Leave dates** must be real `YYYY-MM-DD` days.

### Kit room

`api/_kits.js`, served from `api/guides.js?kits=` (no new function). Kits are
one Redis key (`kits:defs`, seeded once from `inventory.js`); each kit's
whereabouts is its own key (`kits:loc:{id}`) so two moves cannot overwrite each
other; `kits:history` is the log. A move is two steps — `move` returns the
drafted email, `confirm` does it — and the location changes only on confirm.
Recipients come from the `calvary_loans` / `rhh_loans` contacts in Admin →
Notices, never from the request. Into a hospital: that hospital, plus the one
it left; into the office or back home: nobody. **Hospital emails are off
(`kits:settings`) until an admin turns them on after the stock-take** — until
then a move shows the email it would have sent and sends nothing. A move whose
email fails is not recorded, so it can be retried.

**Tray lists** (`kits:list:{id}`): what each tray should hold, `{code,
description, qty, kind}` with `kind` implant (counted) or instrument (ticked).
Uploaded from the kit sheet (`kit/TrayList.jsx`) through the Blob handshake in
`api/meetings/agent.js` (paths under `traylists/`, because a hospital PDF is
past the request-body limit), read by `action=tray-read` with
`api/_trayLists.js`, shown to a person, and only saved on their confirm
(`guides.js?kits=savelist`). The original goes to Dropbox under
`/Tray Lists/Hospital Copies/{Calvary|RHH|TechnoMed}`; the blob is deleted after
reading. For a tray living at a hospital, the hospital's copy wins over our
master list. Saving replaces the kit's tray names with the list's.

The phone unpacks the file (`kit/readTrayFile.js`: Word and PDF text, a
scanned PDF's pages as images, photos shrunk) and sends only that — the Blob
path stalled on hospital wifi. **Tray photos come across**: each picture in the
document becomes a `[PHOTO n]` marker in the text, the reading returns which
photo shows each tray, and on save each photo goes to Dropbox at
`/Tray Lists/Tray Photos/{kit}/{tray}.jpg`; the list stores that path (only
paths under that folder are accepted) and the screen shows it by a temporary
link fetched per view.
**Every item's picture comes across too** (Brent, 11 Nov 2026: "The photos
from Aimee's uploads didn't come across. We need the photos"). A Calvary CSSD
check sheet has the tray photo and then a picture beside each item; only two
a page were kept. Now every picture on a PDF page is drawn out with where it
sits (`pdfPagePhotos` tracks the transform), and `interleaveByHeight` puts its
marker straight after the first line at or below its top edge — its own row;
one drawn large is marked `— large` (`photoMarker`), the tray. The reading
gives a line a fifth value, its picture (`cleanTrays` drops one that is a
tray's photo or used twice); on save each goes to
`/Tray Lists/Tray Photos/{kit}/{tray}/{n code}.jpg` (`tray-photo` with
`itemName`, four at a time), the line keeps `photo` (photos folder only), an
edit keeps it, and an open tray fetches all its links in one call
(`kits=photos`) and shows a thumbnail per row, tapped to full size. RHH's MaQS
check sheets carry no photos at all (only the MaQS logo) — say so rather than
look for them. A list saved before this has no item pictures until its
document is uploaded again.

**Several documents make one list** (Aimee, 4 Nov 2026). The upload takes
several files at once (and "Add another file" during the check); each is read
in turn into one review, each tray remembers its `file`. Saving **adds** by
default (`mode: 'add'` on `savelist`): a tray of the same name is replaced,
every other tray is kept — because a kit like Diplomat comes as one document
per tray. A tickbox starts the list again (`mode: 'replace'`).
**Every tray keeps its own name** (Aimee, 11 Nov 2026: "it overrides them if
you try to upload a second pdf and saves over"). Trays were matched by name,
so two documents whose trays read the same ("Tray 1") kept only the last, and
its photo was filed over the first's. `uniqueTrayNames` (`src/trayNames.js`,
used by `kit/TrayList.jsx` before photos are filed and by `saveTrayList`)
replaces a tray only when it comes from the **same document**; any other clash,
including two in one upload, gets a number — "Tray 1 (2)".

**A saved tray list is live, not read-only.** Anyone signed in can edit a tray
(`kit/EditableTray.jsx`): quantity steppers, code, description, implant or
instrument, add and remove lines, rename. Each change is one call to
`guides.js?kits=editlist` → `editTrayList` (set | add | remove | rename), sent
with the line it was made against; if that line has changed meanwhile it is a
409 with the current list. Every change is in `kits:history` with who made it,
and the open list refreshes through `useLiveRefresh` (not while editing).

### The kit room is everyone's (Brent, 11 Nov 2026)

"Fully interactive and live … staff … don't want to rely on me … a live
ecosystem a bit like Dropbox." **Every member of staff** can add and edit
kits, upload and edit tray lists and add documents (`canEdit` = signed-in
staff in `handleKits`; tray-read/keep/photo in `api/meetings/agent.js` too);
only taking a kit off the list (`canRemove`) and the hospital-email switch
stay with admins and the clinical team. Everything is in `kits:history`.
- **Documents per kit** (`api/_kitDocs.js`, `kit/KitDocs.jsx`): consignment
  agreements and other documents, Redis `kits:docs:{id}`, filed in Dropbox at
  `/Kit Room/{kit}/{Consignment Agreements|Documents}/` (`keep`, never over
  a file), ≤2.8 MB through the request, larger through the Blob handshake
  (`kitdocs/` prefix). Opened by `doc-link` (a path the kit lists, only);
  taking one off leaves it in Dropbox. Dropped files land on a desktop.
- **Share** (`src/kit/share.js`): the file itself through the phone's share
  sheet (`navigator.share` with files), else downloaded. An iPhone refuses a
  share that comes too long after the tap — `needs-tap` keeps the files ready
  and the screen shows "Ready — tap to share". A tray list shares its original
  document(s) (`tray-file`, only paths its own trays hold), else its text.
- **Tiles**: a "Tray list" and "Agreement" chip on each opens the kit at that
  part (`KitDetail focus`); **press and hold anywhere on a tile** (`useHold`,
  380 ms, cancelled by 8 px of movement so a scroll stays a scroll; the click
  that ends a hold is swallowed) or the ⋮⋮ grip drags it — the page cannot
  scroll under a held tile (non-passive `touchmove`) and scrolls by itself
  near the top or bottom edge (Brent, 11 Nov 2026: "I thought I'd be able to
  move the kit room tiles around"; checked in a real iPhone-sized render) —
  a tile — onto another kit to
  reorder (`kits:order`, shared, `saveKitOrder`), onto another place to open
  the move sheet with that place chosen (`MoveSheet initialTo`; a move still
  goes through its email step).
- **Add from Dropbox** (Brent, same day: "Build option 2"): **+ From Dropbox**
  on a kit (`kit/FromDropbox.jsx`) attaches a file already in Dropbox **by its
  path — no copy** (`linked: true`), so the kit opens the current version.
  Only `LINK_ROOTS` are offered or accepted (`/Admin/Consignment Agreements`,
  `/Tray Lists`, `/Kit Room`; `linkablePath`, never the usage tree); the list
  of them is `dropboxCatalogue` (`listFilesUnder`, cached 15 min in
  `kits:dbx:catalogue`). `suggestFor` ranks by the kit's system words in the
  name or folder, its hospital named (another hospital counts against), the
  word "consignment agreement", "signed", PDF, then year; a PDF and Word copy
  of the same name are one. **Attach agreements from Dropbox** (Kit room,
  admins and the clinical team; `kit/AttachAgreements.jsx`, `dbx-autolink`)
  proposes every kit without an agreement at once — clear matches ticked
  (`proposeAgreements`: hospital named and a point clear, or level and newer),
  the rest offered with Skip chosen — and attaches only what was ticked
  (`doc-dbx` with `picks`). On the real folder (11 Nov): 10 clear, 14 to
  choose (signed vs updated copies), 7 KT kits with none.
- **Read in the portal** (Brent, same day: "a viewer built in so you don't
  need to download the consignment agreement"): tapping a kit document (and
  **View original** on a tray list) opens `src/kit/DocViewer.jsx` — a PDF
  drawn page by page with pdf.js (a PDF in a frame shows an iPhone only page
  one; up to 60 pages), a .docx as text through mammoth in a `sandbox=""`
  frame (no script), photos and text as they are, pinchable
  (`data-zoomable`); an old .doc or Excel says so with Download. Share and
  Download in the bar. Checked in an iPhone-sized render: two-page PDF, Word.
- **TM loan kits have no consignment agreement** (Brent, same day: "Just tray
  lists for these kits"): `needsAgreement` (`src/kit/agreements.js`, kind
  `floating` → false) hides the tile's Agreement chip (its Tray list chip
  takes the row), drops the agreement section and button from the kit (other
  documents stay; Add from Dropbox suggests tray lists instead), and keeps
  loan kits out of **Attach agreements from Dropbox**.

### Surgeon preference cards (Task 18)

Editable data, not a page. `api/_preferences.js` keeps them in Redis
(`prefs:current`, a full snapshot per version at `prefs:v:{n}`, `prefs:history`),
seeded once from `src/preferences/seed.js` — generated from Aimee's 28 Oct card by
`scripts/extract-preferences.py`, and `seed.test.js` asserts no phrase was lost.
Served from `api/guides.js?prefs=` (no new function). The clinical team and
admins edit; a save against an older version is refused (409); restoring is a new
version. Bold is `**text**`, never HTML. `GuideView` renders
`pages/PreferenceCards.jsx` for the `surgeon-preferences` slug, so the booking's
Preferences button and Theatre Guides both open it. The static HTML file remains
only as the seed's source. **Cards added from a conversation** (`CARD_ADDITIONS` in
`api/_preferences.js`, Brent 7 Nov 2026: the Synthes Pelvic Recon 3.5 mm card
"under the other orthopaedics cards"): applied on the first read after
shipping, into the group whose name matches (made if none), as a normal new
version; the id is kept in `data.added` so it happens once.
`PREF_ADDITIONS=off` only for the editing tests. Aimee's system guides still carry their own copy of each
surgeon's preferences ("Synced with the Surgeon Preferences app") — those are not
editable here and will drift until she drops them.

### Talking to Claude

Every call goes through `askClaude` / `streamClaude` in `api/_anthropic.js`. Nothing calls the SDK or `api.anthropic.com` directly — the point is that one failure is handled one way wherever it happens.

- **The API's own words never reach a screen.** `AiUnavailable` carries the caller's sentence as `message` and the real cause as `detail`. The caller supplies the sentence, because only it knows what the person was trying to do: "Voice booking is unavailable right now — please fill in the form below."
- **Timeout is 20s, retries are cut to 1.** The SDK defaults — ten minutes, two retries — are sane for a server job and wrong inside a Vercel function that is killed at its `maxDuration`: a call still waiting when that happens is a 504, which is the one failure the app cannot turn into a sentence. A streamed scan gets 55s instead, because a vision pass over six pages legitimately takes most of a minute.
- **Billing and auth failures email `ALERT_EMAIL`, once per feature per day.** Nobody knew the account had run out of credit until a rep hit it in a corridor at RHH. `busy` and `timeout` do not alert — they clear on their own, and an alert nobody can act on teaches people to ignore the sender.

### Email sender

`onboarding@resend.dev` is Resend's *test* address and can only ever deliver to
the Resend account's own owner — every other recipient is refused. It is the last
resort in `api/_email.js`, not a working default, so an unset `EMAIL_FROM` shows
up as the feature being broken. Usage mail is sent as the rep who scanned it
(`sender: { name, email }` from the session, with `reply_to` set to them), which
needs technomed.com.au verified as a domain in Resend. `explainSendFailure()`
names the cause for the two failures this app actually hits, because Resend
reports both as a flat 403.

### Staff roster is the shared source of truth

`src/staffConfig.js` is a hardcoded `STAFF` array (name, `firstName`, email,
division, role, `isAdmin`, `hasTimesheets`). `firstName` is written down rather
than derived because Brenton is **Brent** and Matthew is **Mat** — no rule gets
from one to the other, and it goes on the bookings calendar where it has to match
what the team already writes by hand. Notably, **`api/auth/pin.js` imports it across the frontend/backend boundary** (`import { STAFF } from '../../src/staffConfig.js'`) — so `src/` is not purely client-side. Adding or renaming staff means editing only this file, but a name change also has to match the Xero employee record (see below).

### Leave application lifecycle

1. `LeaveForm.jsx` — 4-step wizard, POSTs the whole form to `/api/submit`.
2. `api/submit.js` — validates the dates and leave type, writes `leave:{id}` and pushes the id onto the `leave:pending` list, then fires a Resend notification email. The employee's email is persisted on the record so later approval/decline mail can reach them.
3. `AdminPortal.jsx` → `api/admin/action.js` — approve or decline. Re-acting on a non-pending application returns 409, so a double-tap cannot submit to Xero twice.
4. On approve: `updateApplicationStatus` moves the id from `leave:pending` to `leave:approved`/`leave:declined`, then **three side effects run independently, each in its own try/catch** — Xero leave application, Google Calendar event, notification email. Any of them can fail without blocking approval; each result and error is returned in the response body (`xeroError`, `calendarError`, `emailError`) and surfaced in the admin UI banner, so a silent integration failure cannot look like a clean approval.

Redis keys: `leave:{id}` (JSON blob), `leave:pending` / `leave:approved` / `leave:declined` (id lists), `pin:{email}` (4-digit PIN, plaintext), `session:{token}` (JSON, 1h TTL), `xero_at` / `xero_rt` / `xero_tid` / `xero_exp`.

All Redis access goes through the single exported `redis()` helper in `api/_redis.js`; don't re-implement it per route (it used to be duplicated in `api/auth/pin.js` and `_xeroClient.js`, which is how the token-encoding mismatch went unnoticed).

Leave type ids used throughout are `ANNUAL_LEAVE` | `SICK` | `TOIL`. Each integration maps them to its own display label with its own local `LEAVE_LABELS` map (`_email.js`, `_googleCalendar.js`) — they intentionally differ ("Personal / Sick Leave" vs "Personal Leave"), so keep the three maps in sync when adding a type.

### Auth

One mechanism, in two parts:

- **Staff PIN** — `api/auth/pin.js`, one handler multiplexing on an `action` field (`check` | `verify` | `set` | `reset` | `logout`). PINs are self-service on first login only; `set` returns 409 if a PIN already exists, so changing one requires an admin `reset`. PINs are stored as plaintext in Redis.
- **Sessions** — `api/_auth.js`. A successful `verify`/`set` mints a `crypto.randomUUID()` token stored at `session:{token}` with a 1-hour TTL. The client keeps it in `sessionStorage` and sends it as `Authorization: Bearer <token>`; `requireAdmin(req, res)` guards `api/admin/*` and the debug action of `api/xero/info.js`, writing the 401/403 itself and returning `null` so handlers just `if (!session) return`.

`isAdmin` is re-read from `staffConfig.js` on every request rather than trusted from the stored session, so revoking admin takes effect immediately. There is no shared admin password — the previous `ADMIN_PASSWORD` secret (and its `'Technoadmin2026'` fallback, which was shipped in the client bundle) is gone; do not reintroduce a secret into `src/`.

### Xero integration (the fragile part)

`api/_xeroClient.js` handles OAuth token refresh and leave submission. Notes:

- Tokens are stored as **four separate short Redis keys** rather than one JSON blob — earlier attempts at a single key failed because Upstash's REST API passes values through the URL path. They are stored **raw, not base64**: Xero tokens are already URL-safe, whereas base64 padding and `+` were being mangled by URL decoding (hence the old `.replace(/ /g, '+')` workaround). `storeXeroTokens()` is the only writer — the OAuth callback and the refresh path both go through it, so the read and write encodings cannot drift apart again.
- Leave type IDs are resolved at submit time by name-matching against the org's `/LeaveTypes` (`LEAVE_TYPE_PATTERNS` in `_xeroClient.js`), which is what makes TOIL work. `FALLBACK_LEAVE_TYPE_IDS` holds the known annual/personal UUIDs and is used only if that lookup fails (e.g. missing `payroll.settings` scope). Inspect the live org with `GET /api/xero/info?action=debug` (admin session required), which returns employee names plus leave type names *and* IDs.
- Employee matching is fuzzy — exact full name, substring, then last-name-only fallback. A `staffConfig.js` name that doesn't resemble the Xero record fails at approval time.
- Dates are sent in Xero's legacy `/Date(ms+0000)/` format, and the API base is the *old* `payroll.xro/1.0` (not the newer AU Payroll API), which is why endpoint paths were repeatedly wrong in the commit history.
- OAuth flow: `/api/xero/connect` (redirect to Xero) → `/api/xero/callback` (token exchange, then `res.redirect('/?xero=...')`). Scopes in `connect.js` must match those configured on the Xero app or consent fails silently.

### Invoices and quotes (Brent, 5 Nov 2026)

Admin → Invoices (`src/pages/admin/Invoices.jsx`), served by `api/xero/info.js`
(`po-list`, `po-read`, `sales-lookup`, `invoice-create`, `quote-create`, all
admin-only; no new function).

- **Purchase orders are read from accounts@**, read-only, through the same
  domain-wide Gmail grant as bookings@ (`api/_purchaseOrders.js`; `PO_MAILBOX`,
  `PO_QUERY` default `from:calvarycare.org.au has:attachment newer_than:120d`).
  Nothing labels, moves or marks a message read. Claude reads the attached PDF
  into lines (`PO_VISION_MODEL`); `cleanOrder` types it and never invents.
- **Drafts only, on a person's tap** (`api/_xeroAccounting.js`). Nothing is
  approved, sent or emailed from Xero. A line with no quantity or a blank price
  is refused, not drafted at $0. A known Xero item code is sent as `ItemCode`;
  an unknown code is kept in the description.
- **Only POs with no invoice are offered** (Brent, 5 Nov 2026). `po-list`
  reads Xero's sales invoices once, from 60 days before the oldest PO
  (`salesInvoicesSince`), finds the PO number in each Reference
  (`invoicedByPo`) and `splitOrders` returns `outstanding` (the only ones with
  Read PO), `invoiced` and `noNumber` (folded away), the same PO sent twice
  counted once. If Xero cannot be asked, nothing is outstanding — it is all
  `unchecked`. Calvary's numbers are mostly **LVH0012240**-style (two letters,
  H or P, seven digits); the reader once knew only LVP/ACP and missed them.
- **PAUSED 6 Nov 2026** (Brent: "until I've chatted to Toni"): `autoInvoice`
  returns `{paused: true}` and drafts nothing unless `PO_AUTO=on` is set in
  Vercel. Reading POs and drafting by hand are unaffected.
- **POs are invoiced by themselves** (Brent, 5 Nov 2026: "the whole point is
  to automate them from email"). `autoInvoice` in `api/_poAuto.js` runs in both
  daily cron jobs and whenever Admin → Invoices opens (`po-auto`): each
  outstanding PO is read with Xero's item list in the prompt (`xeroCode` per
  line) and `planInvoice` drafts it the way every Calvary invoice in Xero
  already looks — contact by PO prefix (`SITES`: LV → Lenah Valley, SJ → St
  Johns), reference = PO number, each line a Xero item **at the Xero price**,
  `F/H Local` freight added (`PO_FREIGHT_CODE`), due in 30 days
  (`PO_DUE_DAYS`). Still **DRAFT** — approving and sending stay in Xero.
  Anything else is **held** with the reason (unmatched line, PO price ≠ Xero
  price, total does not add up, PO number in the PDF ≠ the email's, unknown
  site) and stays on the screen with Try again / Read PO. Results are in Redis
  `po:auto:{po}`; held POs are not re-read each run, failures up to 3 times. A
  90s lock (`po:auto:lock`) stops two passes drafting the same PO.
- **A PO is invoiced once**: before creating, Xero is asked for an ACCREC
  invoice (not voided/deleted) whose Reference contains the PO number; if one
  exists nothing is created (409).
- **Permission is a separate connection**: "Allow invoices" is
  `/api/xero/connect?invoices=1`, adding `XERO_INVOICE_SCOPES` to payroll's.
  A plain "Reconnect Xero" asks for payroll only and drops invoicing, so after
  one, tap Allow invoices again. The scopes must also be enabled on the Xero app.
- **Check accounts@** (`accounts-audit`, `api/_remittances.js`) — read-only:
  Calvary's remittances and other mail in accounts@ over 180 days, the Gmail
  labels each sits under (Toni's filing), and invoice numbers named. Calvary
  pays in batches (one deposit, several invoices), so remittances are what a
  payment would be split by. **Filing by the portal is not built**: the Gmail
  grant is read-only (`gmail.readonly`); labelling needs `gmail.modify` added in
  Google Admin, and the format comes from this report first.
- **Quote templates** (`quote-templates`, `quoteTemplates`) — read-only: every
  quote in Xero for the contact "DRAFT QUOTE TEMPLATE" (`QUOTE_TEMPLATE_CONTACT`),
  with its lines. Brent's self-funding procedure (Dropbox, Admin/Policies and
  Procedures, May 2024) builds each quote from these; they are meant to become
  the rules for drafting Shelley's (CNS) uninsured quotes automatically.
- **Quote requests** (`quote-requests`, `api/_quoteRequests.js`) — read-only:
  CNS self-funding quote requests (quote wording in the **subject** — a booking
  email that only mentions self-funding is not one) found in **bookings@ and brenton@**
  (`QUOTE_MAILBOXES`; Brent, 5 Nov 2026: CNS sends to bookings and cc's him,
  sometimes only him), searched narrowly (CNS domains + quote wording), the same
  email in both counted once by Message-ID. Reading brenton@ uses the same
  domain-wide `gmail.readonly` grant as bookings@.
- **Self-funding quotes draft and follow up by themselves** (`api/_quoteAuto.js`,
  Brent 5 Nov 2026: "use the templates to inform; 20% is blanket for all
  distributors; email the distributor with the quote once we send it; save it
  the same way"). Each CNS request is matched by Claude to one Xero quote
  template; `checkPlan` keeps **only that template's lines and prices**
  (quantities may change for levels, nothing invented), 20% on distributor
  lines unless the template says otherwise; a DRAFT quote for Centre for
  Neurosurgery with the Surgeon/Patient/Date/Procedure/Kit summary. Once the
  quote is SENT in Xero: PDF filed in the surgeon's self-funding folder
  (`quoteFolder`, the team's existing paths; `{Patient} Self Funding Quote
  QU0492.pdf`) and each distributor on it (`distributorsOnQuote`) emailed a
  heads-up with the PDF, from Brent, bookings@ copied — surname only in the
  body. Surgeon / Patient / Procedure for the filing and the heads-up are read
  from the **sent quote's Summary** (`fromSummary`), not the request email —
  the Lewis heads-up said "Surgeon: TBC" because Shelley's email never named
  one. A patient already on a CNS quote in Xero (`alreadyQuoted`, by surname)
  is not drafted again. Runs in both crons and when Invoices opens; records `quote:req:{id}`,
  each step once; held requests have Try again.
- **Quote prices come from Toni's price list** (Brent, 5 Nov 2026, "option 2"):
  the template decides the lines, `api/_priceList.js` the prices — the newest
  `…Distributor_Price_Lists….xlsx` in Dropbox `/Admin/Accounts`
  (`PRICE_LIST_FOLDER`), each tab read from its "Product code" / "Price" header
  row, cached 12h in `pricelist:cache`. `listPrice` matches the exact code, or a
  template code with x's for sizes (`AB0321-xxxxx`) when every match costs the
  same. Anything else keeps the template price and is listed as a **Check:**
  flag on the request (`flags` on the record); an unreadable list flags the
  whole quote rather than holding it.
- **Supplier quotes → purchase orders** (Brent, 9 Nov 2026: "tap check for
  POs in email … read a quote and generate a PO"; Cody at MAC Surgical, quote
  00012501, "updated PO-0147"). Admin → Invoices → **Supplier quotes → PO**
  (`SupplierPos` in `Invoices.jsx`, `api/_supplierPos.js`, actions
  `supplier-quotes` / `supplier-quote-read` / `supplier-po-save` /
  `supplier-quote-dismiss` on `xero/info.js`). Finds supplier emails in
  brenton@ and admin@ (`SUPPLIER_PO_MAILBOXES`, `SUPPLIER_PO_QUERY`; not
  Calvary or CNS) with a quote attached or a PO asked for; Claude reads the
  quote into lines plus `checks` (e.g. a description contradicting the item);
  the supplier is matched to a Xero contact and a PO named in the email
  (`ourPoNumber`) is fetched. Save either **replaces the named PO's lines**
  (keeping its status, account and tax; never a BILLED PO) or makes a **new
  DRAFT PO**; quote number goes in the Reference. Nothing is sent to the
  supplier — that is done from Xero. Each email remembers what was done
  (`supplierpo:{messageId}`). Uses the invoices connection's Xero permission.
- **Check a sales report** (Brent, 9 Nov 2026: "you need to be able to cross
  check with the portal"). Admin → Invoices → **Check a sales report**
  (`SalesReportCheck` in `Invoices.jsx`, `action=sales-check` on
  `api/usage/agent.js`, admins only; logic in `api/_salesCheck.js`). Upload a
  distributor's monthly report (.xlsx; Signus's layout: Invoice No, Carrier =
  surgeon, Project Name = patient, Code, Qty, Sales — the header row is found by
  its words). Each invoice is matched to its case: usage records first
  (`usageCasesBetween`, same surname, up to `LOOKBACK_DAYS` 120 before the
  invoice, scored by hospital, surgeon and codes in common), then the bookings
  calendar. The same workbook comes back with **Surgery Date / Found in /
  Check** added after the last column (never inserted — the report's own total
  and 30% formulas must keep pointing at the same cells) and a **Not on this
  report** sheet: the distributor's portal cases from the first case covered to
  the last invoice that no invoice matches. Checks: no usage / not found,
  calendar date ≠ usage date, surgeon or hospital ≠, code billed not on the
  usage or more billed than used (`sameCode` lets "MACNIT18470 R/R" match
  "MACNIT18470"), a unit price under that code's top price **at the same
  hospital** (RHH and Calvary prices differ — not a discount), and the same case
  on two invoices. Read-only; the report is never stored.
  **Device's layout too** (Brent, 10 Nov 2026): Billing Doc / Billing Date /
  Bill-To-Party, surgeon as a full name with a title, patient as the hospital
  typed it (surname + UR, or first name + surname). `samePatient` looks for the
  portal surname among the field's words; `sameSurgeon` matches any word. A
  **Procedure Date** column narrows matching to ±7 days and flags a
  disagreement; Device and Boost are one distributor there (`family`).
- **Claude's read-only key** (`api/agent.js`, same day): `AGENT_READ_KEY` in
  Vercel (32+ chars; unset or short = 404). `GET ?action=usage&from=&to=` (≤400
  days; codes and quantities, never lot numbers or the rep) and `POST
  ?action=sales-check {file}`. Nothing else, nothing writes; every call, refused
  ones included, is logged to `agent:log` (last 500). The cloud environment
  holds the same value as `TM_PORTAL_AGENT_KEY`.
- **Discount per line** (`DiscountRate`, 0–100) — self-funding quotes carry
  the standard 20% off implants. A quote's **Summary** holds the Surgeon /
  Patient / Procedure lines. **Paste lines** reads rows copied from a
  spreadsheet (code, description, qty, price, discount; `src/invoiceLines.js`),
  skipping headers and total rows and never guessing a price.

### Google Calendar

Service-account JWT signed inline with `node:crypto` `createSign` — no `googleapis` dependency. `getGoogleToken(scope)` in `api/_googleCalendar.js` is the single signer; `api/calendar/today.js` imports it with `CALENDAR_SCOPE_READONLY` and the write path uses `CALENDAR_SCOPE_WRITE`. Approved leave becomes an all-day event on `bookings@technomed.com.au` in Grape (`colorId` 3), with `end` shifted +1 day per Google's exclusive-end convention. `TodayView.jsx` reads that same calendar back and distinguishes leave from bookings by `colorId`.

**Every calendar day in the app is a `YYYY-MM-DD` string in Australia/Hobart,
produced by `src/clinicalPlan/week.js`.** Not a `Date`, and never the device's
locale. That module already anchors the week plan; the calendar view did not use
it and rolled its own, which is the whole of the "app gets the dates mixed up"
bug: the day was held as a `Date` and keyed with `toISOString()` (UTC) while the
heading beside it came from `getDay()`/`getDate()` (the device). In Hobart those
disagree for the first ten hours of every day — eleven in summer — so before 10am
the heading named one day and the events shown were the day before, and after
10am it agreed with itself again, which is why it read as intermittent.

If you add a screen that shows a date, use `todayStr`, `parseDateStr`,
`addCivilDays`, `mondayOf` and `weekdayName` from `week.js`. `TodayView.test.jsx`
pins the clock to 8am Hobart and to summer AEDT specifically, and the suite is run
under several `TZ` values — a screen that reads the device's timezone fails.

The week starts **Monday** everywhere: the plan, the fortnight anchor, and now the
calendar strip, which alone had started on Sunday.

`api/calendar/today.js` uses the same helpers for its window. It previously added
a fixed ten hours and called `setHours` on the result, which resolved against the
server's timezone (UTC on Vercel) and was an hour out from October to April.

### Usage scanning

Reps photograph a hospital "Record of Implantable/Rebatable Items Used" form; it is read by vision extraction, filed to Dropbox, and emailed to each distributor whose products appear.

`api/usage/agent.js` routes `scan` → `save` → `email` → `list` off `?action=`, in **one** serverless function. That is not stylistic: Vercel's Hobby plan caps a deployment at 12 functions and the app is now exactly at 12, which is also why `api/meetings/agent.js` is shaped the same way. Splitting these into the four separate files the spec describes needs a Pro plan first.

The domain rules live apart from the route so they can be tested and edited without touching the request handling:

- **`api/_distributors.js`** — the contact groups, the `DISTRIBUTOR_RULES` product→distributor patterns, the exclusion list (Floseal, TachoSil, Gelfoam, Surgicel and other haemostats — **dropped from a scan entirely** by `normaliseCase`, not listed as excluded; Brent, 5 Nov 2026), and `CLINICAL_TEAM_CC`. Rule order matters: `BOOST` must be tested before the generic Device match, and the allograft rules before anything matching a bare "global". This is the only file to edit when contacts or systems change.
- **`api/_usageCase.js`** — normalises an extraction into a case: Australian-order dates, Calvary/Royal Hobart → `CLV`/`RHH`, `x1`/`×4` quantities, surname extraction, and the `{Surname}_{DDMMYYYY}_{Surgeon}_{Procedure}_{Hospital}` folder name. The procedure there is a **label, not a description** (Brent, 5 Nov 2026): `procedureLabel` keeps only ACDF, ALIF, PLIF, TLIF, Fixation and Boost UF (Boost also from the items used), joined by `+` — e.g. `Hollis_05112026_Thani_ACDF_CLV` — else an acronym from the form, else two words. **The model's own `distributor` field is deliberately ignored** — `detectDistributor` re-derives it, because emailing the wrong company is worse than flagging a row.
- **`api/_usageExcel.js`** / **`api/_usagePdf.js`** / **`api/_dropbox.js`** — the usage sheet, photos combined into one PDF, and the `ALL SURGEON USAGE/SPINE/{Surgeon}/{Month Year}/{Case}` tree.

  The sheet is a **header block over a narrow item table**, not a wide grid. It
  was twenty columns with all seven case details repeated on every row so that a
  row would stand alone in a pricing workbook; on the phone it is actually opened
  on, that was several screens of sideways scrolling made mostly of the same case
  detail. Details now appear once, vertically, and the table below carries only
  what differs per item — about 105 characters wide against 380.

  Pricing, Rep Name, Manual Review Flag and Notes are gone as columns. Unit Price
  and the live Extended Price formula were the reason a row had to stand alone and
  were never filled in. `buildUsageWorkbook(caseRecord, items, { internal })`
  takes `internal: true` for the Dropbox copy, which is the only caller that
  needs the two facts those columns carried — see the invariants below.

  Distributor is a header line when every row shares one (every email attachment)
  and a column when they do not (the Dropbox copy).

Invariants worth preserving:

- **The rep who scanned it is recorded three ways.** Their name is a `Scanned by`
  line in the header block of the *internal* sheet (it was a column repeated on
  every row, and the Dropbox copy is the only place it belongs — a distributor has
  no use for it), they are the sender of the distributor email, and their `firstName` is
  appended to the matching booking on the calendar as `(Brent)` — `markAttendance`
  in `api/_googleCalendar.js`. That last one writes to the team's shared calendar,
  so it is strictly additive: it appends and never reformats, it is idempotent, and
  a day with two bookings for the same surname is **left alone** rather than
  guessed at. It runs in its own try/catch and is reported, never thrown — a
  calendar that will not take a title change must not cost the filing.
- **A test send goes to the signed-in user and nowhere else.** `testOnly: true` on
  the email action replaces every distributor recipient with `session.email`, drops
  the CC, marks the subject `[TEST]`, and says in the body who it would have gone
  to. The address is taken from the session and *never* from the request body:
  this attaches a workbook of patient identifiers, so an endpoint that mailed it to
  a caller-supplied address would be a way to walk that data out on one valid staff
  login. A test is also not written to `emailsSent`, so it cannot make a case look
  sent when the distributor has had nothing.
- **Nothing uncertain is ever sent.** `groupByDistributor` skips anything excluded, flagged, or without a resolved distributor. Held-back rows still appear on the Dropbox sheet — shaded amber, with a `Held back from email` line in the header block saying how many. That replaced the `Manual Review Flag` column and is the whole record that they did not leave the building, so it has to survive any further tidying of that sheet. A distributor's sheet never shades a row: it is built from items that already passed the filter, and amber would be telling them a transcription was uncertain.
- **The same patient's usage on the same day goes to a distributor once**
  (`earlierSends` in `api/_usageRepeat.js`, checked in `action=email`).
  Matthews, 6 Nov 2026: one form scanned twice, two cases with different folder
  names, Device's Boost desk emailed twice. A distributor that already had a
  usage for that surname and date from another case is **held** (`held: true`,
  shown amber, "Send to … anyway" sends with `confirmRepeat`); a real addition
  belongs in Amend, which sends a correction. Tests are never held.
- **Each distributor gets a case once** (review, 6 Nov 2026). `action=save`
  over an existing id keeps the *stored* `emailsSent`, `createdAt`,
  `createdByEmail` and `amendments` (a phone's stale copy used to wipe the
  record of a send), and once a real send has gone the `folderName` is frozen.
  `action=email` holds a distributor this case already went to (`held`, same
  "Send anyway" → `confirmRepeat`), claims each send (`claimUsageSend`, SET NX
  120s) so a double tap sends once, and merges results onto the record as
  re-read after sending. A removed record is 410 on save and email and never
  goes back on `usage:all`.
- **A case is filed once** (Brent, 6 Nov 2026: "is there already a folder in
  Dropbox?"). Before anything is written, `action=save` checks the portal's
  records and the Dropbox case folders for that patient and day
  (`caseFoldersOnDay` — names only in one surgeon's month folder, a deliberate
  narrow exception to the read lock, matching `{Surname}_{DDMMYYYY}_` so a
  differently-read procedure cannot hide it) and compares items by code, lot /
  graft number and quantity (`findDuplicate` in `api/_usageDuplicate.js`).
  Identical or nothing new → 409 `duplicate`, nothing filed or sent, and the
  review shows **AlreadyFiled** (Discard); something new → Amend the earlier
  case; a folder with no record → confirm. "It is a different operation"
  sends `confirmSeparate`, filed under `freeFolderName` (`…_2`) so it can never
  land in or overwrite an existing folder. A folder of exactly this case's name
  and no record is a retry of the same save and passes. After a save the
  screen keeps the case id, so a test then the real send update one case.
  **Remove duplicate** (admins, or whoever scanned it) takes a case off history,
  Still owed and matching — `removeUsageRecord`, kept under `usage:removed`,
  never erased; Dropbox and the email log are untouched.
- **The Boost tracking form is scanned on its own and goes to the Boost team
  alone** (Brent, 9 Nov 2026: one email to boost@ + ortho + spine
  marketing let the graft be processed twice). `device_boost` usage goes to
  `dl_spine_marketing` + `ortho` only, for resupply, labelled Boost. The form
  is a separate scan: **Boost tracking form** (`scan/BoostForm.jsx`) on the
  Done screen of a Boost case and as **Boost form** on its row in Past scans
  (`hasBoost` / `boostFormSentAt` from `action=list`) → `action=boost-form`:
  those pages only, to `BOOST_TRACKING` (`boost@device.com.au`, cc
  `admin@technomed.com.au`), "Boost tracking only – …", "for tracking only —
  not a usage … do not resupply" (`sendBoostTrackingEmail`); filed beside the
  usage as `{folder}_Boost_Tracking_Form.pdf` (`keep: true`); recorded as
  `emailsSent` key `boost_tracking`, once (409 unless `confirmRepeat`); a test
  goes to the rep only and is neither recorded nor filed.
- **The surgeon must be one the portal knows** (Brent, same day: a case was
  read with the surgeon as the patient and the patient as the surgeon, and
  filed under a new surgeon folder named after the patient — "the portal needs
  to know that [the patient] is not a surgeon and should be able to tell that
  Thani is a surgeon because he's known to the portal"). `knownSurgeon` in
  `api/_usageCase.js` uses `normaliseSurgeon` from `parse.js` — the same
  `SURGEON_KEYS` and aliases the bookings are read with ("Dr Nova Thani",
  "Nova", "Thanni" → Thani; JPW files as `Peters-Willke`, its Dropbox folder,
  via `SURGEON_FOLDER`). `normaliseCase`: a known surgeon is spelled the
  portal's way; one of ours in the patient box with an unknown surgeon is
  swapped back (`namesSwapped`, said on review); any other unknown surgeon is
  `surgeonUnknown`. `recomputeCase` respells a typed surgeon. Review shows
  "not one of our surgeons — pick the surgeon" with a button per known
  surgeon, or a tick for a genuinely new one; `action=save` refuses an unknown
  surgeon (it would make a new surgeon folder) unless `newSurgeonConfirmed`. A
  record already saved wrong is corrected on read by `api/_usageFixes.js` —
  keyed by a SHA-256 of its old folder name, never the name.
- **Tap a past usage to see its files** (Brent, 9 Nov 2026: "tap the usage
  from past scanned usages and see your scanned files"). In Past scans the
  case's name is a button (`data-open-usage`) that opens `scan/CaseFiles.jsx`:
  the record's `filesSaved` under its `dropboxPath` (scan, sheet, amended
  sheets, Boost tracking form), each opened through `action=open`, which only
  opens files the portal itself filed (`isPortalFiled`) — the rest of the usage
  tree stays locked. A PDF or photo is fetched from the temporary link into a
  blob and shown in Chat's `FileViewer`; a spreadsheet downloads; a link that
  cannot be previewed opens in a new tab.
- **Dropbox succeeds before any email goes out**, so a failed save is retryable without double-sending.
- **The distributor email carries two attachments**: the 20-column sheet of their
  own items, and the scanned form with every page merged into one PDF
  (`buildScanPdf`). Most distributors need the signed original for traceability,
  not only the transcription.

  The pages come **with the email request**, not out of storage, because nothing
  stores them — the record holds the transcription, not the photographs, and the
  PDF built during save goes to Dropbox and is discarded. So the scan reaches the
  distributor whether or not Dropbox is connected. A retry after the app has been
  reloaded has no pages to resend: the sheet still goes and `scanError` says the
  form did not, rather than leaving its absence to be noticed at the other end.

  Note what this means: the scanned form is one hospital sheet listing every
  system used, so **every distributor sees the whole form**. The *sheet* is still
  split — a distributor never sees another's line items, and there is a test for
  that — but the scan is not splittable. Raised and accepted deliberately. Emails record a per-distributor outcome and a single failure can be retried with `{ only: [key] }`.
- **Patient data never reaches a log or an email body.** Identifiers travel only inside the Excel attachment. Error strings never interpolate extracted content — keep it that way when adding to this module.
- **Images are downscaled to 1568px client-side** (`src/pages/UsageScan.jsx`). That is both Claude's effective maximum resolution and what keeps a 3-page form under Vercel's 4.5MB request-body limit. Do not remove it and post full-resolution photos.

### Resupply scanning (Brent, 6 Nov 2026)

The Scan tab is one camera with a choice of what the paper is — **Usage |
Resupply** (`scan/ScanKind.jsx`, remembered per phone in `tm_scan_kind`;
`ScanTab.jsx` picks the screen). Tray restock and stock-take join that row
later. `ResupplyScan.jsx` reuses UsageScan's page helpers and `CameraSheet`.
**Both draw their capture step with `scan/ScanPages.jsx`** (Brent, 6 Nov 2026:
"keep it consistent … mimic the scan pages of Google Drive"): a white card
with a page-and-corners picture and one round shutter before the first page;
then a strip of thumbnails (number, ×, ‹ ›) ending in a dashed "Add page"
tile, one wide "Read N pages" pill and Upload. `NewScanButton` is the start
pill on both. UsageScan's local `Header` now wraps Shell's, so both tabs share
one header; the Usage | Resupply switch hides mid-scan on both. New scan
kinds use these — never a screen of their own.

What comes back after a usage — a delivery docket, packing slip, or the photo
E4 replies to the usage email with — is read (`RESUPPLY_PROMPT` in
`api/_resupply.js`, surname only as on the usage side), matched to the saved
usage case (`candidateCases`: the usage folder name as a reference beats the
surname, then date, surgeon, product codes in common; a case with none of that
distributor's items is never offered; matched outright only when named and
clearly ahead, else the person picks), and compared **by product code, never
lot** — resupplied stock has new lots (`compareResupply`: used, back before,
this paper, still owed; lines the case did not use listed apart as a top-up or
substitute). Device and Boost count as one company there.

Recording is `action=resupply-save` in `api/usage/agent.js` (no new function):
one key per resupply, **appended** to `resupply:case:{usageId}` — never a
field rewritten on the usage record, so two people cannot overwrite each other
— and claimed by the client's id (`claimResupply`, SET NX) so a double tap or a
retry saves once. The pages are filed **in the usage case's own Dropbox folder,
the way the team already names them**: `{Surname} {Distributor} resupply.pdf`,
`{Surname} partial {Distributor} resupply {n}.pdf` (`resupplyFileName`; the
second and later are "partial … n").
**Matching to usage only** (Brent, 10 Nov 2026: "remove the owed items … the
previous system is in place … at this stage let's just match it to usage").
The **Still owed** list, `action=resupply-owing` and the Decisions "Resupply
owed" source are gone; the review and Done screens show **Matched to the
usage** — each used line "N on this paper ✓" or "not on this paper", and lines
on the paper that the usage did not have. `compareResupply` still computes
`owing` internally (stored as `owingAfter`); nothing shows it. The stock
review process is in the bookings doc — read it before building any more here.
**Matching was too strict** (Erin and Mat, 10 Nov 2026). Lines pair with used
items by `codeMatch` (identical, or a code read short or with/without the
maker's prefix, or the same digits) and, only where a code is missing, by
description (`pairLines`); each line to one item. A docket naming no patient
offers the distributor's cases from the three weeks before it (`recent case`)
and pushes cases over 45 days old down. **Find the case** on the review
(`action=resupply-find`, `findCases`: surname, surgeon or folder name over
the last 600 records) picks any case the scan did not offer.
A code with characters lost from the middle (`codesRelated`: same start, the
shorter's characters in order within the longer, at most four missing) pairs
**only when the descriptions agree too** (Mat, same day: "SEA-85-09" off an
obscured sticker for "SEA-85-0509"). **Amend can now correct the code of an
existing line** (`data-amend-code`); it was only quantities and new lines.

### The scanner

`src/pages/scan/CameraSheet.jsx` plus four modules in `src/scanner/`:

- **`opencvLoader.js`** — loads `public/vendor/opencv-4.13.0.js` (11MB, WASM
  embedded) once per session. Served from this origin, not docs.opencv.org, which
  is documentation hosting rather than infrastructure. The version is in the
  filename so `vercel.json` can cache it immutably for a year.

  **The handshake is the part that breaks.** The file ends `return cv(Module)`, so
  what lands on `window.cv` is a *thenable* whose `.Mat` does not exist yet and
  which resolves to itself. Three separate ways of getting this wrong all present
  identically — "Edge detection loading", for ever, on a device that downloaded
  the file perfectly:

  1. waiting for `window.cv.Mat`, which never appears on the thenable;
  2. seeding `window.cv.onRuntimeInitialized` before the script, which the UMD
     wrapper's `root.cv = factory()` discards;
  3. `resolve(module)` — the Promise machinery *adopts* a thenable, calling `then`,
     which hands back the module, which is adopted again, for ever. `delete
     module.then` before resolving is what fixes it.

  `npm run check:engine` runs the real file through the real handshake in jsdom
  and is the only check that catches any of this. Run it after touching the
  loader; a mock cannot see these.

  Never fetch the file to report progress. That was tried: response → chunks →
  Blob → `.text()` → `eval` is several copies of 11MB plus a 22MB UTF-16 string,
  and on a phone holding a camera stream it gets the tab killed — which presents
  as the camera not opening at all.
- **`documentDetect.js`** — Canny → `findContours` → **convex hull** →
  `approxPolyDP`, then `chooseCandidate` ranks every 4-gon over 20% of the frame.

  **Largest does not win, and must not.** The surface a page is lying on is always
  a larger quadrilateral than the page — a table shot from above, a cutting mat, a
  desk — and just as four-sided, so "largest" put the outline on the table with
  its corners off the edges of the picture. Nothing downstream could help: the
  answer was confidently wrong rather than noisy. Two rules, each with a fallback
  so an awkward frame still gets an outline rather than none:

  1. **A candidate enclosing a lighter one is the surface, not the page** — and
     "lighter" is judged against the enclosing candidate's *own border band*, not
     its whole interior. Most of a mat's interior **is** the page: measured whole
     it read 205 against the page's 208, three levels apart and useless. The band
     inside its border is the mat, at 168. The tone test is also what stops this
     preferring a form's inner print box, which is enclosed by the page but the
     same tone as it — without that, an older bug returns where the outline
     snapped to the heavy rule under a form's header.
  2. **A quad clipped by the frame edge loses to any wholly visible one**, because
     cropping to it would cut the form off whether or not it is the page.

  `chooseCandidate` is exported and unit-tested directly in
  `documentDetect.test.js`. The frame-edge rule has no other cover: a flat surface
  running off the picture leaves no closed contour, so the synthetic scenes cannot
  produce a clipped candidate at all. Three details are
  load-bearing and each fixed a real failure: the hull (print reaching a margin
  joins the border and made the outline a 16-gon), filtering on *hull* area rather
  than contour area (a border broken anywhere traces an open ribbon enclosing
  nothing, so the largest survivor became the region below a form's header rule),
  and ladders of Canny thresholds and approx epsilons because no single value
  spans a form on a dark bench and the same form on a white one.
- **`documentTracker.js`** — the anti-jitter, and the thing the rebuild was
  actually for. **Rewritten once already**: the first version averaged eight
  detections with linear weights and froze the outline below a 3% shift, and came
  back as "still sluggish and sloppy, deviates all over the place". All three
  faults were separate — a weighted mean puts four fifths of the outline where the
  page *was*; a wrong detection is blended in rather than rejected; and freezing
  then jumping is a worse artefact than the jitter it hides.

  Now: exponential smoothing whose gain rises with movement, gated by a jump
  filter, and no freeze. **The gain keys off direction, not distance** — that is
  the whole design. Keying it off distance is the obvious thing and it is wrong,
  because the detector's own noise moves its answer a long way *every* frame, so
  noise scores as movement and gets followed at the fast gain. `trackDrift`
  compares a smoothed delta *vector* against the smoothed *length* of those
  deltas: reversing noise shrinks the first and not the second, movement in a line
  keeps them equal. Kept per corner, because a page being brought closer moves its
  four corners in four opposing directions and an average across them cancels
  exactly as noise does.

  `jumpTolerance` (7%) and `jumpConfirmations` (3) were **measured, not chosen** —
  see the numbers in `documentTracker.test.js`. The detector's wrong answers land
  8–10% out, so the original 12% gate let every one through; and its wrong answer
  on a given scene is usually the *same* wrong answer, so at two confirmations it
  only had to appear twice in a row to be believed, at which point the outline
  snapped 8% onto it. Two → three took the worst jump from 8.34% to 0.10%.

  Also decides auto-capture: 800ms still, `minFill` of the most the page could
  cover, enough contrast — about 0.86s from acquiring a page to the shutter. The
  toggle in the camera view stays and gates it.

  **`minFill` has been wrong in both directions.** At 0.6 it worked only because
  the detector was locking onto the *table*, which filled the frame; the moment
  that was fixed, auto-capture stopped firing entirely, because a page held at a
  working distance covers about 28% of a portrait frame (and there `fill` is close
  to the raw area, since `most` is near 1.0). It is 0.25 now, consistent with the
  detector's own 20%-of-frame floor: nearly anything detected and held still is
  worth capturing, and a page half the frame's width is still about a thousand
  pixels across on a 1920-wide capture.

  A rejected outlier does **not** restart the stillness clock. Rejecting a
  detection as noise for drawing and then trusting it enough to make the shutter
  wait is incoherent, and it means a camera producing an outlier more often than
  every `stillForMs` can never auto-capture however still the page is held. A jump
  that is real confirms within three frames, and that path does restart it.
- **`cameraStream.js`** — one shared stream, module-level, held across pages. A
  component that stops its tracks on unmount re-opens the camera for every page,
  which on iOS is a stall and a second of black each time.

**Resolution is the first thing that makes a scan unreadable** (Bowes usage,
5 Nov 2026: filed at ~800x1100 px, about 100 dpi, sticker lot numbers
illegible). iPhone Safari has no full-resolution still from a web page, so the
page comes from a video frame, and the stream was stuck at 1920: `raiseResolution`
tried only the camera's maximum (4032), which an iPhone offers only as a 4:3
photo mode, so the shape check reverted it every time. It now walks
`WIDTH_LADDER` (4032, 3840, 3264, 2880, 2560, 2304) and keeps the first width
that keeps the shape — 3840x2160 on an iPhone — and asks even when
`getCapabilities` says nothing. The review screen measures the page
(`pageDpi` in `rectify.js`) and, under `MIN_READABLE_DPI` (150), says "Not
enough detail to read the stickers" with **Use the phone's camera** (the
existing photo picker, which on iOS offers the 12 MP system camera). Filed
copies are JPEG 0.92 (`FILE_JPEG_QUALITY`), and photos from the picker now keep
a 2400 px filing copy instead of being shrunk to the 1568 reading size.

**Android (Aimee's Samsung S25 FE, 5 Nov 2026) was worse, for two reasons.**
Asked for width alone, Chrome opened a 1920x886 stream — the screen's 19.5:9,
cut from the middle of the sensor, so the view was narrowed and a page got ~880
px across. And the full-resolution photo (`takeStill`, ImageCapture) was
discarded because its 4:3 shape did not match the video's. Now: where
ImageCapture exists, `constraintLadder()` asks for `aspectRatio: 4/3` first
(the sensor's native shape — crops nothing; iPhones keep the width-only
request), `stripSize` keeps a requested aspect when raising the width, and a
photo of another shape is used anyway, the outline carried across by the
centred crop between the two (`cornersOnStill` in `stillMapping.js`) before
the usual re-detection on the photo. `takePhoto` is told `fillLightMode: 'off'`
unless the torch is on — an auto flash over steel is glare on the stickers.
The camera hint shows which rule made an outline unsure (`unsureWhy`: one edge
faint / corner in glare / corners disagree) and the stream size, small, so a
screenshot says what the phone saw. The review's detail line should read
`photo` and several thousand pixels on Android; `best of 5` there means the
photograph path failed.

**The review's photograph is 2048 px at JPEG 0.88** (`EDITOR_IMAGE_DIM`). It
was 900 px at 0.7 to keep corner-dragging light, and stretched over a phone
screen it made a crisp 3024x4032 capture look as though resolution was lost
on the shutter. The filed copy never came from it — `asItWillBeSaved` warps
the full photo at `FILE_IMAGE_DIM` when the page is accepted.

**HD photo — the phone's own camera** (Brent, 5 Nov 2026: "pull out all the
stops"). A button on the scanner releases the portal's stream (an Android
camera app will not open while a page holds the camera — `releaseCamera`
*before* the click) and opens `<input type="file" capture="environment">`: the
phone's camera app, full sensor, its own autofocus, stabilisation and HDR — what
Dropbox's scanner uses. The photo is drawn the right way up at up to 4096 px
(`photoToCanvas` in `scanner/photoFile.js`) and goes through the **same**
`review()` step as a live capture (re-detection, flattening, the review), with
method `phone camera`. In HD, "Yes — scan it" and Retake reopen the phone's
camera inside the tap; "Back to the live scanner" re-acquires the stream.
`takeStill` now focuses once (`focusMode: 'single-shot'`, `FOCUS_SETTLE_MS`)
before `takePhoto` where the camera offers it, then goes back to continuous.
**Check the detail** on the review opens the page as it will be filed
(`asItWillBeSaved().full`) at its own pixel size, to pan across the stickers
before anything is filed or sent.

Two constraints here were learned the hard way and must not be undone:

- **Never request a width *and* a height.** An iPhone has several rear lenses at
  several native aspect ratios; asking for a shape it does not have is satisfied
  by cropping the sensor or picking a longer lens, and the preview comes back
  magnified with a form that will not fit in it. Hint one dimension (`width:
  {ideal: 1920}`) so a sharp mode is chosen, never both.
- **The engine must never gate the camera.** It loaded behind a full-screen
  "Starting the scanner…", which on a hospital connection is most of a minute of
  nothing moving and no way to take a photograph. It now downloads with a
  progress chip and a 45s deadline while the shutter works throughout; without it
  there is no outline and the whole photograph is kept.

The first camera permission prompt is browser-enforced and cannot be removed from
the app. What the code guarantees is one `getUserMedia` per session — the prompt
is per page load, so on iOS a standalone PWA launch will ask again unless the site
is set to Allow in Safari's settings.

**The shutter only fires by itself on an outline it is sure of** (Aimee's
stainless bench at RHH, 4 Nov 2026). `detectDocument` returns `confident`:
every measurable side has a clear step under it (`weakestSide >= 0.65`), or
the weak side is busy with print rather than empty (`filledSide >= 0.9`, a
page printed to its border). Wrong answers on the steel scenes all had an
empty side (0.14–0.64); right ones 0.71 and up. The tracker needs the last
three detections confident (`sureFrames`); otherwise the reason is `unsure`,
the outline is drawn dashed, and the person taps. The bench now has six steel
scenes (`paintMetal` in `scenes.js`: brushing, gradients, seams, reflections,
glare), counts wrong outlines the shutter would take, and runs 40 noisy frames
per scene through the real tracker — it fails on any wrong auto-capture.
Two more rules make an outline unsure: a corner in near-white glare
(`cornerInGlare`), and another good candidate for the same page (three corners
agreeing) putting the fourth somewhere else (`disputed`) — on a clean frame
every method agrees to a pixel; where glare erased an edge they disagree about
the corner it hid.

Finding the page on steel (same day):
- **The bright-region fallback closes before it opens** (`REGION_CLOSE`).
  Without it a form's printed rules cut the paper into strips and the region
  search never saw a page — which is why it never rescued a shiny bench.
- **`refineQuad` re-fits a nearly right outline**, run (twice) on any
  candidate with a weak side, at most `MAX_REFINES` distinct seeds a frame.
  Each side is searched along its normal for the nearest point where the
  inside matches the paper's tone and the outside is darker *and stays darker*
  — medians of six pixels, so a printed rule drops out and glare (brighter
  than paper) never qualifies — then a robust line (`robustLine`) through
  those points, so a seam crossing the side is one outlier. Re-fitted quads go
  through the same tests and ranking as everything else.
- **Samples under near-white glare are not counted** in `edgeSupportDetail`
  (`GLARE`), like a side along the frame's edge. Its softer halo was tried and
  rejected: it excused real sides on pale steel and cost steadiness.

`scripts/scanner-stress.mjs [count] [seed] [detector]` makes random stainless
benches (position, size, angle, streaks, seams, reflections, glare) and runs
each through the real detector and tracker. On 200 scenes (seed 42): 142
outlined correctly and 115 captured by themselves, against 104 and 87 before
this work, **with 0 wrong auto-captures** — the number that must stay at zero.
Pass another detector file as the third argument to compare.

A Hough line-pairing approach was tried for glare-broken edges and removed: it
more than doubled detection time and found no page the contours missed.
`scripts/scanner-diag.mjs "<scene>"` lists every candidate considered.

**Detection runs at 240×180 on every second frame**, and low is deliberate: a page
border survives downscaling and a form's printed table rules do not, so the small
frame is *more* accurate as well as four times faster. Every third frame was a
third more latency for very little — detection measures about 2ms.

**Do not restore the early exit from the Canny ladder.** It used to stop at the
first threshold that found any quadrilateral, reasoning that this was the most
selective one that could and there was nothing to gain by looking further. That is
wrong whenever a frame contains two candidates, and it was the single largest
cause of the outline jumping about: on the tilted-bench scene one rung found the
page (1.3px out) and another found something 25px out, whichever fired first
flipped with the sensor noise, and comparing their *areas* would have picked
correctly every time — the wrong candidate was the smaller. Removing the exit took
accuracy from 8/15 to **12/15** and that scene's frame-to-frame jump from 13.5% of
frame width to 0.06%.

A previous-frame coherence bonus was tried alongside it and **deliberately
removed**: it changed no outcome on any of the twelve scenes, and a rule that
biases selection toward the last answer can only create stale locks. The ladder
fix was the whole of it.

Treat that bench as a regression check, not as evidence about real performance.
The hand-written detector it replaced scored 11/15 there and was unusable on an
actual phone — single-frame accuracy on piecewise-flat synthetic renders turned
out not to predict either temporal stability or Canny's behaviour on a real
camera frame.

**Reading is per page, in parallel, at medium effort** (Brent, 6 Nov 2026:
"cut it to 15-20 seconds"): `readForm` in `api/usage/agent.js` sends each
page as its own request at `USAGE_VISION_EFFORT` (default medium), joins them
with `mergeExtractions` (header from the first page that has each field, items
in page order), and re-reads a page at high effort when its answer is
unusable or truncated. `USAGE_FAST=off` restores the single full-effort read.
`maxDuration` for the usage function is 120s (Vercel Pro).

The vision call uses `claude-opus-5` (first pass at medium effort, see above), streaming (a slow extraction would otherwise hit the HTTP timeout), overridable via `USAGE_VISION_MODEL`. `budget_tokens` and `temperature` are rejected on this model family — don't add them. `maxDuration` is set to 60s in `vercel.json`; a very long form on a slow connection can still exceed it, which needs a Pro plan (300s).

### Timesheets

Fortnightly timesheets under Payroll → Timesheets, submitted to Xero AU Payroll and approved by Brenton or Erin in the Admin portal.

**`FORTNIGHT_ANCHOR` in `api/_fortnight.js` is the single source of every pay period.** It is `2026-06-15`. The spec said "Monday 16 June 2026", but 16 June 2026 is a Tuesday; Monday→Sunday is the load-bearing shape (it drives the grid, the Xero `NumberOfUnits` ordering and the Sunday deadline), so the anchor is that week's Monday. Changing this constant shifts every period — do it deliberately.

- **`api/_fortnight.js`** — all period maths, on UTC date-only strings so no server timezone can shift a boundary. "Today" is AEST (UTC+10), matching `api/calendar/today.js`.
- **`api/_payItems.js`** — `CATEGORY_RULES` maps Xero earnings-rate *names* to categories, ordered most-specific-first: the two Toni rates must be tested before the generic `/ordinary/`, or she would get the wrong rate. Earnings rate **IDs always come from Xero**, never hardcoded. An unrecognised Xero rate is surfaced as `kind: 'other'` rather than hidden, so a new rate shows up instead of silently going missing.
- **`api/_timesheetValidate.js`** — totals and validation. `src/pages/Timesheets.jsx` mirrors `computeTotals` so the running total a staff member sees is the number that gets validated; **change both together.** A `unit: 'count'` category (call-in allowance) must never add to the hours total.
- **`api/_timesheetXero.js`** — `NumberOfUnits` has **one value per day of the period, so 14 for a fortnight.** The spec's example showed 7; a 7-value array silently drops the second week. Length is derived from the period rather than written down.

**No per-day limit.** Staff enter the hours they worked; the old "over the 7.6h
standard day" warning and overtime nudge are gone (Erin works 8-hour days).
**Hours over a full-time contract become TOIL**: `src/timesheetRules.js`
`toilOverflow`, for roster rows with `contract: { fortnightHours: 76,
overflowToToil: true }` (Aimee, Ben, Mat). Ordinary hours over 76 less approved
leave move to `toil_accrued` from the end of the fortnight back; double time
entered stays double time. The screen shows the split before submit and the
server applies the same function on submit (idempotent).

Flow and invariants:

- Staff submit → Xero as `DRAFT`. Admin approve → the **same** Xero timesheet (`TimesheetID` included in the POST, which makes it an update) flips to `APPROVED`. That is how the spec's "submit to Xero" and later "approval triggers the pay run" both hold.
- **Validation runs before Xero**, so invalid hours never leave the app; and Xero is called before the record is stored, so a submitted record always means Xero accepted it.
- Resubmission is blocked with 409 unless the timesheet was returned; returning requires a reason.
- `api/cron/timesheet-reminder.js` is now both daily jobs (Hobby allows two), chosen by `?job=`: `evening` 07:00 UTC (6pm AEDT) sends the "usage not sent" reminders (`api/_usageReminders.js`, Task 11), `morning` 22:00 UTC (9am AEDT) escalates yesterday's unsent usage to the week's team leader and, on Sat/Sun only, sends the timesheet reminders as before. It verifies `CRON_SECRET`. **Tasmania observes daylight saving**, so from October to April this lands at 9am local — Hobby allows only two crons total, so there is no seasonal second pair. Staff `mobileNumber` fields in `staffConfig.js` are blank, so every reminder is currently skipped rather than sent.

**Call-ins are logged, not only offered** (Brent, 7 Nov 2026: "Mat gets a
call-in logged for pt White"). `callInsFor` (`src/clinicalPlan/callIn.js`)
marks a case `auto` when it is out of hours, the person is on the booking (or
nobody is), **and** the calendar's on-call roster has them on call that day.
`action=callins` then writes it into their timesheet draft as one call-in on
that day (`logCallIns` in `api/timesheet/agent.js`) — once per case: the ids
are kept as `autoCallIns` on the draft (a draft save from the screen keeps
them), so one taken off stays off. Never into a fortnight already filed, and
only where the person's pay items include `call_in`. The screen shows
"✓ Call-in logged" with the hours buttons for double time past five hours and
"Take it off". A rep on the booking who was **not** on call is still only
offered it (tap to add).
**Only people paid call-ins** see either (`paidCallIns`: on timesheets and
`call_in` among their pay items) — Brent attends cases as a director and is
not paid them (7 Nov 2026).

## Verifying changes

`npx vitest run` is the suite. `npm run bench:scanner` measures the document
detector against the synthetic scenes in `src/scanner/scenes.js` — which now
include a page on a table with the table's edge in frame, and `scene()` takes a
`surface` quad for it. Every other scene puts the page on an infinite flat
background, which is why none of them could produce the table failure — the suite's own
timing checks are deliberately loose because jsdom timing swings by a factor of
five between runs, so that script is the real figure.

It reports two things, and the second matters more. **Accuracy** is single-frame
corner error. **Steadiness** runs the real detector over one scene for 24 frames
with fresh sensor noise on each and reports how far the *drawn* outline moves
between consecutive frames; it fails the run above 2% of frame width. Single-frame
error cannot see the fault that actually made the scanner feel broken — a detector
can be accurate on average and still draw an outline that will not sit still — and
it was this measurement that found the Canny early exit.

Two more cheap checks worth running after touching `api/`:

```bash
npm run build                     # catches frontend breakage
for f in $(find api -name '*.js' -not -name '_*'); do \
  ./node_modules/.bin/esbuild "$f" --bundle --platform=node --format=esm \
    --log-level=warning --outfile=/dev/null; done
```

The second resolves every import in each route and fails on a missing named export. Three shipped routes were broken that way (`sendApprovalEmail`/`sendDeclineEmail`, `getXeroToken`/`findEmployee`) because nothing type-checks the `api/` boundary — run it before pushing.

### Dropbox connection

`api/_dropbox.js`. Connected like Xero from Admin → System → **Connect
Dropbox**: `guides.js?dropbox=connect` (admin) → Dropbox → `/api/dropbox/callback`
(a `vercel.json` rewrite to `guides.js?dropbox=callback`, answered before the
session check and trusting only a `state` issued in the last ten minutes). The
refresh token is kept in Redis (`dropbox_rt`); access tokens are minted from it
and cached (`dropbox_at`/`dropbox_exp`), because Dropbox access tokens now last
four hours. Calls carry `Dropbox-API-Path-Root` set to the TECHNOMED team folder
(`dropbox_root`, found on connecting, or `DROPBOX_ROOT_NAMESPACE`), which is what
makes `/ALL SURGEON USAGE/...` and `/Tray Lists/...` land in /TECHNOMED.
`DROPBOX_ACCESS_TOKEN` alone still works for a quick test.

**Reading the usage folders is locked** until the redaction is finished
(Brent, 2 Nov 2026): `listFolder`, `temporaryLink`, `searchUsage` and
`patientHistory` refuse any path under `/ALL SURGEON USAGE` unless
`DROPBOX_USAGE_READS=on`. Filing new usage (writes) is unaffected. Do not read
those folders — through the app or otherwise — without Brent's explicit say-so.

### Treasury (private)

A financial and Bitcoin dashboard for Brent alone, under Me → Treasury.
`api/treasury.js` is one function switched on `?action=`; the helpers are
`api/_treasury*.js`; the arithmetic is `src/treasury/logic.js` (shared by both
sides); the screens are `src/pages/treasury/`.

- **Who.** `TREASURY_USERS` (comma-separated emails). Unset means nobody.
  Everyone else — signed out, other staff, other admins — gets a plain 404
  identical to a missing route, and the Me card only appears after the server
  has answered `access` with a 200. The Treasury chunk is lazy-loaded from
  `App.jsx` and deliberately **not** in `lazyScreens.jsx`, which is prefetched
  onto every phone.
- **Face ID is enforced by the server.** `LockScreen` hands its fresh sign-in
  to `action=unlock`, which accepts it only if minted in the last two minutes
  for the same person, destroys it, and records `treasury:unlock:{hash}` for 15
  sliding minutes against the main session. Without it every action is a 403
  `{locked: true}` — to that person only.
- **Everything stored is encrypted** (AES-256-GCM, `TREASURY_ENC_KEY`) through
  `tget`/`tset` in `_treasuryStore.js`, audit log included. Never write a
  `treasury:` key with `redis()` directly.
- **Every request is audited**, refusals included (`treasury:audit`, capped).
- **Xero is read-only and separate.** Its own Xero app and tokens
  (`TREASURY_XERO_*`), granular `.read` scopes only, and `_treasuryXero.js` has
  exactly one accounting call, a GET. A test fails on any other method. Don't
  reuse `_xeroClient.js` — that connection can write payroll.
- **On-chain data** comes from BGeometrics (`bitcoin-data.com`), stored per
  metric so charts work when it is down. The free tier is tiny: requests are
  counted in `treasury:onchain:budget` and capped (8/hour, 15/day), six per run.
  Price falls back to Kraken candles; MVRV/STH-MVRV/LTH-MVRV are extended from
  price ÷ cost basis when their series stops.
- **Cron:** `/api/treasury?action=cron` at 19:40 and 07:40 UTC (needs Pro — the
  two Hobby slots are the timesheet jobs). It syncs on-chain, warms the price,
  and takes the month's snapshot if there is none.
- **No financial data in the repo or tests**, ever. Fixtures are invented.

## Environment

Required: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RESEND_API_KEY`, `EMAIL_FROM`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`. Treasury: `TREASURY_USERS`, `TREASURY_ENC_KEY`, `TREASURY_XERO_CLIENT_ID`/`_SECRET`/`_REDIRECT_URI` (optional `TREASURY_XERO_TENANT`, `TREASURY_XERO_SCOPES`, `BGEOMETRICS_TOKEN`). Optional: `DROPBOX_APP_KEY` + `DROPBOX_APP_SECRET` (then connect in Admin → System), `DROPBOX_USAGE_READS`, `DROPBOX_ROOT_NAMESPACE`, `GOOGLE_CALENDAR_ID`, `ALERT_EMAIL`, `EMAIL_TO_1..3`, `XERO_TENANT_ID` (fallback only — the OAuth callback stores the real tenant in Redis). `.env.example` is current; the `process.env` reads in `api/` remain authoritative.

### Email

`technomed.com.au` must be a **verified domain in Resend**. Without it every outgoing email is refused with a 403 — which is how the portal spent weeks unable to send anything at all, with the only symptom being raw Resend JSON on a phone screen.

Senders, decided in `fromAddress()` in `api/_email.js`:

| Email | From | Why |
|---|---|---|
| Usage to a distributor | the rep's own `@technomed.com.au` address | "Distributors must be able to reply directly to a usage email, so a noreply sender is not acceptable." Reply reaches whoever was in the theatre. |

A usage email goes **only to the distributor it is for** — no Bcc, no archive mailbox, no second copy. A silent Bcc to `usage@` was built and removed on Brent's instruction, because it contradicts a rule set on 4 October: Dropbox is the store of record and the app never keeps a copy. A mailbox full of attachments is exactly the second copy that rule exists to prevent — two copies means "has this been filed?" has two answers that drift. The sent-email log is the record **that** a usage went; the documents themselves are in the Dropbox case folder.
| Everything else | `EMAIL_FROM` | Leave decisions, timesheet notices, meeting minutes — these are from the portal, not a person. |

`EMAIL_FROM` is **required** and must be on the verified domain. An `@resend.dev` address is refused by the app before Resend sees it, because Resend's own error for that case ("you can only send testing emails to your own email address") reads like a broken feature rather than a setting nobody updated.

There is **no fallback sender**. A rejected send fails loudly: staff see `Email not sent — please contact Brenton.` and the technical cause goes to the server log and the sent-email log. The previous silent retry — reported as success — is what let a usage go out from an address the distributor could not reply to.

Every send is recorded by `api/_emailLog.js`, readable at Admin → Email. **The subject is deliberately not stored**: for a usage email it is the case folder name, which is built from the patient's surname. The case id is the link back instead. Each entry carries a **`label`** saying which email it was without the patient (Brent, 6 Nov 2026: "no way to tell which outgoing message it is"): booking and loan notices build it from the notice word, supplier, systems, surgeon, hospital and day (`New booking → Signus · Ibbett · RHH Fri 6 Nov`); usage is `Usage · {distributor}`; leave, timesheet, meeting and PIN emails use their subject, which names staff, never patients. Admin → Email shows it with To and Cc.

## Conventions

- API helpers shared between routes are prefixed with `_` (`api/_redis.js`, `api/_email.js`) so Vercel does not expose them as endpoints.
- Styling is almost entirely inline style objects; brand colours live as CSS custom properties in `src/index.css` (`--tm-navy` `#042746`, `--tm-accent` `#2ab5a0`, `--tm-grape` `#8E24AA`). `LeaveForm.module.css` exists but the component uses inline styles instead.
- Reference data (kit/distributor/hospital lists in `KitRoom.jsx`, quotes in `PinScreen.jsx`) is hardcoded as module-level constants inside the component file.
- Australian English in all user-facing copy ("authorised", "colour").
- Anything interpolated into email HTML goes through `escapeHtml` in `api/_email.js` — `reason` and `declineReason` are free text typed by staff.
