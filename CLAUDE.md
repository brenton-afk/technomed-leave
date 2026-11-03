# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server (frontend only — /api calls proxy to localhost:3000)
vercel dev       # Full stack incl. serverless functions on :3000 — needed to exercise /api
npm run build    # Production build to dist/
npm run preview  # Serve the built dist/
```

There is no test runner, linter, or formatter configured. Deployment is Vercel (production: `leave.technomed.com.au`); pushing to `main` deploys.

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
- **A `@media print` block undoing all of it.** A viewport-height frame with
  hidden overflow clips a printout to one screen, and the case plan has `@page A4`
  rules and gets printed.

No screen inside the shell may set `minHeight: 100vh` — the region is already the
viewport minus the header and the bar, so a child demanding a full viewport makes
every screen scroll by the height of that chrome. `PinScreen` and `Success` render
before the shell and are the exceptions. `design/safeArea.test.js` asserts all of
this.

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

The third mode, **Team lead** (`TeamLeader.jsx`), is the Clinical Team Leader
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

### Weak signal and offline

`public/sw.js` now has a fetch handler, under narrow rules written at the top of
the file: the page is **network first** (the saved copy only on failure or a 5s
stall, so a deploy is never hidden), content-hashed `/assets/` are cache first,
`/api/` is **never** intercepted, and `/vendor/` is left to the HTTP cache. The
shell is saved at install, because the first visit loads before the worker is in
control. Saved files are matched with `ignoreVary` — the server sends
`Vary: Origin` and a module request carries an Origin the install fetch did not.

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

**Search** is the magnifying glass in the Cases header (`cases/CaseSearch.jsx`,
`action=search` in `api/calendar/today.js`): Google's own full-text search over
2020 to a year ahead, each hit read through `readBooking`, cases only.

**Surnames from every reader go through `surnameFromField` in `parse.js`** —
emails, dictation, the RHH list and usage forms. It keeps a surname field whole
and drops a given name after a comma or in lower case after a capitalised
surname. Titles typed by hand use `handTypedSurnameLength` plus title/Pt-line
agreement. Never go back to "first word" (or, for usage forms, "last word").

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
on its own. Device Technologies are on no rule: they asked not to get booking
notices. Notices for an edit made offline and sent later are not offered.

**A supplier is judged on the booking as it now stands** (the hospital, before
or after): a case switched from Diplomat to Mariner offers Signus nothing — Brent
does not want them told about a case that is no longer theirs — and Device gets
the loan request. A cancellation is judged on the booking as it was.
**The hospital's loans team is told about loan sets** (`hospitalLoanNoticesFor`,
`DEFAULT_HOSPITAL_LOAN_NOTICES`: Calvary on, RHH off): ordered, changed (set or
date), no longer coming — tracked per booking as `loanreq:{event}:hosp-CLV` so
it is said once. The auto-add card and Edit booking choose systems by button
(`cases/KitPicker.jsx`), writing the same kit line the notices read. Mariner is
offered as **Mariner MIS** and **Mariner Open** (`SYSTEM_BUTTONS`, `variantOf`
in `inventory.js`) — one Mariner said precisely; tapping either replaces a plain
"Mariner" and keeps its supply.

### System suggestions and Brainlab billing (Brent, 3 Nov 2026)

`src/clinicalPlan/systemSuggestions.js` holds Brent's operation → system rules
(`SYSTEM_GROUPS`) and surgeon defaults (`SURGEON_SYSTEMS`): a thoracolumbar
fixation offers pedicle screw systems only, ACDF offers cervical cages, ALIF is
Catenary only, and so on. It narrows the buttons, never forbids — everything
stays behind "All systems". Not yet wired to a screen: the Add booking layout
waits on Brent approving a mock-up.

Brainlab / AIRO is navigation, not an implant system. At **RHH** TechnoMed runs
the navigation and AIRO and **bills Brainlab per case: $300 with AIRO, $250 for
navigation without AIRO** (mostly stereotactic needle biopsies and complex
cranial). At **Calvary** we do not support navigation and do not bill. Bookings
are meant to become the single source of truth on the front end (e.g. to
populate the Brainlab invoice) and usages on the back end (resupply).

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

**A saved tray list is live, not read-only.** Anyone signed in can edit a tray
(`kit/EditableTray.jsx`): quantity steppers, code, description, implant or
instrument, add and remove lines, rename. Each change is one call to
`guides.js?kits=editlist` → `editTrayList` (set | add | remove | rename), sent
with the line it was made against; if that line has changed meanwhile it is a
409 with the current list. Every change is in `kits:history` with who made it,
and the open list refreshes through `useLiveRefresh` (not while editing).

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
only as the seed's source. Aimee's system guides still carry their own copy of each
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

- **`api/_distributors.js`** — the contact groups, the `DISTRIBUTOR_RULES` product→distributor patterns, the exclusion list, and `CLINICAL_TEAM_CC`. Rule order matters: `BOOST` must be tested before the generic Device match, and the allograft rules before anything matching a bare "global". This is the only file to edit when contacts or systems change.
- **`api/_usageCase.js`** — normalises an extraction into a case: Australian-order dates, Calvary/Royal Hobart → `CLV`/`RHH`, `x1`/`×4` quantities, surname extraction, and the `{Surname}_{DDMMYYYY}_{Surgeon}_{Procedure}_{Hospital}` folder name. **The model's own `distributor` field is deliberately ignored** — `detectDistributor` re-derives it, because emailing the wrong company is worse than flagging a row.
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

The vision call uses `claude-opus-5` at `effort: 'high'`, streaming (a slow extraction would otherwise hit the HTTP timeout), overridable via `USAGE_VISION_MODEL`. `budget_tokens` and `temperature` are rejected on this model family — don't add them. `maxDuration` is set to 60s in `vercel.json`; a very long form on a slow connection can still exceed it, which needs a Pro plan (300s).

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

Call-in detection reads after-hours bookings from the calendar, but the calendar has no rep field — it cannot know whose case it was, so these are always prompts, never auto-entered.

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

Every send is recorded by `api/_emailLog.js`, readable at Admin → Email. **The subject is deliberately not stored**: for a usage email it is the case folder name, which is built from the patient's surname. The case id is the link back instead.

## Conventions

- API helpers shared between routes are prefixed with `_` (`api/_redis.js`, `api/_email.js`) so Vercel does not expose them as endpoints.
- Styling is almost entirely inline style objects; brand colours live as CSS custom properties in `src/index.css` (`--tm-navy` `#042746`, `--tm-accent` `#2ab5a0`, `--tm-grape` `#8E24AA`). `LeaveForm.module.css` exists but the component uses inline styles instead.
- Reference data (kit/distributor/hospital lists in `KitRoom.jsx`, quotes in `PinScreen.jsx`) is hardcoded as module-level constants inside the component file.
- Australian English in all user-facing copy ("authorised", "colour").
- Anything interpolated into email HTML goes through `escapeHtml` in `api/_email.js` — `reason` and `declineReason` are free text typed by staff.
