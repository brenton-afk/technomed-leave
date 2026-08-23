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

`src/pages/TodayFeed.jsx` is the home screen: a scrolling feed, not a dashboard. It surfaces today's cases, the day's flags, the signed-in user's action items and an unsubmitted-timesheet prompt. Every item is a pointer into a section — the feed never becomes a place to do work.

`src/pages/FileBrowser.jsx` serves both Resources and filed usage sheets from Dropbox, since they are the same problem. Paths are constrained server-side to the usage and resources roots (`assertAllowedPath` in `api/usage/agent.js`); without that, any signed-in user could read the whole Dropbox account. Temporary links are fetched per tap and never stored — a persisted one would be a public URL to patient data.

Session lives in `sessionStorage` under `tm_user` (includes the session `token`) and `tm_login_time`. `loadStoredSession()` enforces a one-hour age limit on restore and re-checks every minute, matching the server-side Redis TTL in `api/_auth.js` — keep the two constants in step.

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

Calendar times are handled with a manual `+10h` AEST offset, not a timezone library, despite `date-fns` being a dependency.

### Usage scanning

Reps photograph a hospital "Record of Implantable/Rebatable Items Used" form; it is read by vision extraction, filed to Dropbox, and emailed to each distributor whose products appear.

`api/usage/agent.js` routes `scan` → `save` → `email` → `list` off `?action=`, in **one** serverless function. That is not stylistic: Vercel's Hobby plan caps a deployment at 12 functions and the app is now exactly at 12, which is also why `api/meetings/agent.js` is shaped the same way. Splitting these into the four separate files the spec describes needs a Pro plan first.

The domain rules live apart from the route so they can be tested and edited without touching the request handling:

- **`api/_distributors.js`** — the contact groups, the `DISTRIBUTOR_RULES` product→distributor patterns, the exclusion list, and `CLINICAL_TEAM_CC`. Rule order matters: `BOOST` must be tested before the generic Device match, and the allograft rules before anything matching a bare "global". This is the only file to edit when contacts or systems change.
- **`api/_usageCase.js`** — normalises an extraction into a case: Australian-order dates, Calvary/Royal Hobart → `CLV`/`RHH`, `x1`/`×4` quantities, surname extraction, and the `{Surname}_{DDMMYYYY}_{Surgeon}_{Procedure}_{Hospital}` folder name. **The model's own `distributor` field is deliberately ignored** — `detectDistributor` re-derives it, because emailing the wrong company is worse than flagging a row.
- **`api/_usageExcel.js`** / **`api/_usagePdf.js`** / **`api/_dropbox.js`** — the 20-column sheet (Extended Price is a live formula so it fills in when a unit price is typed), photos combined into one PDF, and the `ALL SURGEON USAGE/SPINE/{Surgeon}/{Month Year}/{Case}` tree.

Invariants worth preserving:

- **The rep who scanned it is recorded three ways.** Their name is a column on the
  sheet, they are the sender of the distributor email, and their `firstName` is
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
- **Nothing uncertain is ever sent.** `groupByDistributor` skips anything excluded, flagged, or without a resolved distributor. Held-back rows still appear on the Dropbox sheet marked `YES` in Manual Review Flag; they just do not leave the building.
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
  `approxPolyDP`, largest 4-gon over 20% of the frame. Three details are
  load-bearing and each fixed a real failure: the hull (print reaching a margin
  joins the border and made the outline a 16-gon), filtering on *hull* area rather
  than contour area (a border broken anywhere traces an open ribbon enclosing
  nothing, so the largest survivor became the region below a form's header rule),
  and ladders of Canny thresholds and approx epsilons because no single value
  spans a form on a dark bench and the same form on a white one.
- **`documentTracker.js`** — the anti-jitter, and the thing the rebuild was
  actually for. Eight-frame weighted average, then the drawn outline is *not
  moved at all* until the average shifts more than 3% of frame width, then a
  500ms fade instead of blinking out. Also decides auto-capture: 800ms still,
  ≥60% of frame, enough contrast.
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

**Detection runs at 240×180 on every third frame**, and low is deliberate: a page
border survives downscaling and a form's printed table rules do not, so the small
frame is *more* accurate as well as four times faster (`npm run bench:scanner`
shows 8/15 at 240 against 5/15 at 640).

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

Flow and invariants:

- Staff submit → Xero as `DRAFT`. Admin approve → the **same** Xero timesheet (`TimesheetID` included in the POST, which makes it an update) flips to `APPROVED`. That is how the spec's "submit to Xero" and later "approval triggers the pay run" both hold.
- **Validation runs before Xero**, so invalid hours never leave the app; and Xero is called before the record is stored, so a submitted record always means Xero accepted it.
- Resubmission is blocked with 409 unless the timesheet was returned; returning requires a reason.
- `api/cron/timesheet-reminder.js` runs Fri/Sat 22:00 UTC = Sat/Sun 8am AEST, verifying `CRON_SECRET`. **Tasmania observes daylight saving**, so from October to April this lands at 9am local — Hobby allows only two crons total, so there is no seasonal second pair. Staff `mobileNumber` fields in `staffConfig.js` are blank, so every reminder is currently skipped rather than sent.

Call-in detection reads after-hours bookings from the calendar, but the calendar has no rep field — it cannot know whose case it was, so these are always prompts, never auto-entered.

## Verifying changes

`npx vitest run` is the suite. `npm run bench:scanner` measures the document
detector's accuracy and speed against the synthetic scenes in
`src/scanner/scenes.js` — the suite's own timing checks are deliberately loose
because jsdom timing swings by a factor of five between runs, so that script is
the real figure.

Two more cheap checks worth running after touching `api/`:

```bash
npm run build                     # catches frontend breakage
for f in $(find api -name '*.js' -not -name '_*'); do \
  ./node_modules/.bin/esbuild "$f" --bundle --platform=node --format=esm \
    --log-level=warning --outfile=/dev/null; done
```

The second resolves every import in each route and fails on a missing named export. Three shipped routes were broken that way (`sendApprovalEmail`/`sendDeclineEmail`, `getXeroToken`/`findEmployee`) because nothing type-checks the `api/` boundary — run it before pushing.

## Environment

Required: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RESEND_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`. Optional: `GOOGLE_CALENDAR_ID`, `EMAIL_FROM`, `EMAIL_TO_1..3`, `XERO_TENANT_ID` (fallback only — the OAuth callback stores the real tenant in Redis). `.env.example` is current; the `process.env` reads in `api/` remain authoritative.

## Conventions

- API helpers shared between routes are prefixed with `_` (`api/_redis.js`, `api/_email.js`) so Vercel does not expose them as endpoints.
- Styling is almost entirely inline style objects; brand colours live as CSS custom properties in `src/index.css` (`--tm-navy` `#042746`, `--tm-accent` `#2ab5a0`, `--tm-grape` `#8E24AA`). `LeaveForm.module.css` exists but the component uses inline styles instead.
- Reference data (kit/distributor/hospital lists in `KitRoom.jsx`, quotes in `PinScreen.jsx`) is hardcoded as module-level constants inside the component file.
- Australian English in all user-facing copy ("authorised", "colour").
- Anything interpolated into email HTML goes through `escapeHtml` in `api/_email.js` — `reason` and `declineReason` are free text typed by staff.
