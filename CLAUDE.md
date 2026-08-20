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

`src/App.jsx` renders a fixed bottom tab bar and switches pages via a `activeTab` state string. `BrowserRouter` is mounted but no `<Routes>` exist — URL paths do nothing. Adding a screen means adding a `TABS` entry plus a `case` in `renderContent()`.

Session lives in `sessionStorage` under `tm_user` (includes the session `token`) and `tm_login_time`. `loadStoredSession()` enforces a one-hour age limit on restore and re-checks every minute, matching the server-side Redis TTL in `api/_auth.js` — keep the two constants in step.

### Staff roster is the shared source of truth

`src/staffConfig.js` is a hardcoded `STAFF` array (name, email, division, role, `isAdmin`, `hasTimesheets`). Notably, **`api/auth/pin.js` imports it across the frontend/backend boundary** (`import { STAFF } from '../../src/staffConfig.js'`) — so `src/` is not purely client-side. Adding or renaming staff means editing only this file, but a name change also has to match the Xero employee record (see below).

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
- **Sessions** — `api/_auth.js`. A successful `verify`/`set` mints a `crypto.randomUUID()` token stored at `session:{token}` with a 1-hour TTL. The client keeps it in `sessionStorage` and sends it as `Authorization: Bearer <token>`; `requireAdmin(req, res)` guards `api/admin/*` and `api/xero/debug.js`, writing the 401/403 itself and returning `null` so handlers just `if (!session) return`.

`isAdmin` is re-read from `staffConfig.js` on every request rather than trusted from the stored session, so revoking admin takes effect immediately. There is no shared admin password — the previous `ADMIN_PASSWORD` secret (and its `'Technoadmin2026'` fallback, which was shipped in the client bundle) is gone; do not reintroduce a secret into `src/`.

### Xero integration (the fragile part)

`api/_xeroClient.js` handles OAuth token refresh and leave submission. Notes:

- Tokens are stored as **four separate short Redis keys** rather than one JSON blob — earlier attempts at a single key failed because Upstash's REST API passes values through the URL path. They are stored **raw, not base64**: Xero tokens are already URL-safe, whereas base64 padding and `+` were being mangled by URL decoding (hence the old `.replace(/ /g, '+')` workaround). `storeXeroTokens()` is the only writer — the OAuth callback and the refresh path both go through it, so the read and write encodings cannot drift apart again.
- Leave type IDs are resolved at submit time by name-matching against the org's `/LeaveTypes` (`LEAVE_TYPE_PATTERNS` in `_xeroClient.js`), which is what makes TOIL work. `FALLBACK_LEAVE_TYPE_IDS` holds the known annual/personal UUIDs and is used only if that lookup fails (e.g. missing `payroll.settings` scope). Inspect the live org with `GET /api/xero/debug` (admin session required), which returns employee names plus leave type names *and* IDs.
- Employee matching is fuzzy — exact full name, substring, then last-name-only fallback. A `staffConfig.js` name that doesn't resemble the Xero record fails at approval time.
- Dates are sent in Xero's legacy `/Date(ms+0000)/` format, and the API base is the *old* `payroll.xro/1.0` (not the newer AU Payroll API), which is why endpoint paths were repeatedly wrong in the commit history.
- OAuth flow: `/api/xero/connect` (redirect to Xero) → `/api/xero/callback` (token exchange, then `res.redirect('/?xero=...')`). Scopes in `connect.js` must match those configured on the Xero app or consent fails silently.

### Google Calendar

Service-account JWT signed inline with `node:crypto` `createSign` — no `googleapis` dependency. `getGoogleToken(scope)` in `api/_googleCalendar.js` is the single signer; `api/calendar/today.js` imports it with `CALENDAR_SCOPE_READONLY` and the write path uses `CALENDAR_SCOPE_WRITE`. Approved leave becomes an all-day event on `bookings@technomed.com.au` in Grape (`colorId` 3), with `end` shifted +1 day per Google's exclusive-end convention. `TodayView.jsx` reads that same calendar back and distinguishes leave from bookings by `colorId`.

Calendar times are handled with a manual `+10h` AEST offset, not a timezone library, despite `date-fns` being a dependency.

## Verifying changes

There is no test runner, so the two cheap checks worth running after touching `api/`:

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
